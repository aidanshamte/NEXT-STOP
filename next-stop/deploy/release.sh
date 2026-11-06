#!/usr/bin/env bash
# Installs a NEXT STOP release on the Azure VM and rolls back automatically if it
# is not healthy. Runs as root (Azure Run Command or sudo over SSH).
#   release.sh <release-id>            download <id>.tgz from the releases container
#   release.sh <release-id> <file.tgz> install a tarball already copied to the VM
set -euo pipefail

RELEASE="${1:?usage: release.sh <release-id> [tarball]}"
LOCAL_TARBALL="${2:-}"
[[ "$RELEASE" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid release id" >&2; exit 2; }

# shellcheck source=/dev/null
source /etc/next-stop/deploy.env # NEXT_STOP_DOMAIN, RELEASE_CONTAINER_URL, BACKUP_BLOB_CONTAINER_URL
BASE=/opt/next-stop
DIR="$BASE/releases/$RELEASE"
DATA=/var/lib/next-stop
DB="$DATA/next-stop.db"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { echo "[release $RELEASE] $*"; }

storage_token() {
  curl -sSf -H Metadata:true \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).access_token))'
}

fetch_blob() { # name, destination
  curl -sSf -H "Authorization: Bearer $TOKEN" -H "x-ms-version: 2021-08-06" \
    "$RELEASE_CONTAINER_URL/$1" -o "$2"
}

schema_of() { # database file -> user_version (0 if absent)
  [[ -f "$1" ]] || { echo 0; return; }
  node --no-warnings -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1],{readOnly:true});process.stdout.write(String(d.prepare("PRAGMA user_version").get().user_version));d.close()' "$1"
}

wait_healthy() { # expected release id
  for _ in $(seq 1 30); do
    if curl -sSf http://127.0.0.1:4000/health 2>/dev/null | grep -q "\"release\":\"$1\""; then return 0; fi
    sleep 1
  done
  return 1
}

# 1. Obtain and verify the release.
if [[ -n "$LOCAL_TARBALL" ]]; then
  cp "$LOCAL_TARBALL" "$WORK/release.tgz"
  if [[ -f "$LOCAL_TARBALL.sha256" ]]; then cp "$LOCAL_TARBALL.sha256" "$WORK/release.tgz.sha256"; fi
else
  TOKEN="$(storage_token)"
  fetch_blob "$RELEASE.tgz" "$WORK/release.tgz"
  fetch_blob "$RELEASE.tgz.sha256" "$WORK/release.tgz.sha256"
fi
if [[ -f "$WORK/release.tgz.sha256" ]]; then
  expected="$(cut -d' ' -f1 "$WORK/release.tgz.sha256")"
  actual="$(sha256sum "$WORK/release.tgz" | cut -d' ' -f1)"
  [[ "$expected" == "$actual" ]] || { echo "Checksum mismatch; refusing release" >&2; exit 3; }
  log "checksum verified"
fi

# 2. Unpack and install only the server's production dependencies.
rm -rf "$DIR"
mkdir -p "$DIR"
tar -xzf "$WORK/release.tgz" -C "$DIR"
(cd "$DIR/server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
echo "RELEASE_ID=$RELEASE" >"$DIR/release.env"
chown -R root:root "$DIR"
chmod -R go-w "$DIR"

# 3. Apply service/proxy configuration shipped with the release.
install -m 644 "$DIR/deploy/systemd/next-stop.service" /etc/systemd/system/next-stop.service
install -m 644 "$DIR/deploy/systemd/next-stop-backup.service" /etc/systemd/system/next-stop-backup.service
install -m 644 "$DIR/deploy/systemd/next-stop-backup.timer" /etc/systemd/system/next-stop-backup.timer
install -m 644 "$DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
set -a
# shellcheck source=/dev/null
source /etc/next-stop/deploy.env
set +a
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl daemon-reload

# 4. Back up before any migration can run.
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
SCHEMA_BEFORE="$(schema_of "$DB")"
PRE_BACKUP=""
if [[ -f "$DB" ]]; then
  PRE_BACKUP="$(sudo -u nextstop env DATABASE_PATH="$DB" node "$DIR/server/backup.mjs" backup \
    --out "$DATA/backups/pre-deploy" --keep 10 | sed -n 's/^Backup written and verified: //p')"
  log "pre-deploy backup: $PRE_BACKUP"
fi

# 5. Switch atomically and start.
ln -sfn "$DIR" "$BASE/current.next"
mv -T "$BASE/current.next" "$BASE/current"
systemctl enable --now next-stop-backup.timer >/dev/null
systemctl restart next-stop
systemctl reload caddy 2>/dev/null || systemctl restart caddy

if wait_healthy "$RELEASE"; then
  log "healthy (schema $SCHEMA_BEFORE -> $(schema_of "$DB"))"
  # Keep the five newest releases plus whatever is current.
  ls -1dt "$BASE"/releases/*/ | tail -n +6 | while read -r old; do
    [[ "$(readlink -f "$old")" == "$(readlink -f "$BASE/current")" ]] || rm -rf "$old"
  done
  exit 0
fi

# 6. Automatic rollback.
log "NOT healthy; rolling back"
journalctl -u next-stop -n 40 --no-pager || true
systemctl stop next-stop
if [[ -z "$PREVIOUS" || ! -d "$PREVIOUS" ]]; then
  log "no previous release to roll back to; service left stopped"
  exit 1
fi
if [[ -n "$PRE_BACKUP" && "$(schema_of "$DB")" != "$SCHEMA_BEFORE" ]]; then
  # The new code migrated the schema; the old code cannot read it. Restore the pre-deploy copy
  # (the replaced file is kept beside it, never deleted).
  sudo -u nextstop env DATABASE_PATH="$DB" node "$PREVIOUS/server/backup.mjs" restore --file "$PRE_BACKUP"
  log "restored pre-deploy database backup"
fi
ln -sfn "$PREVIOUS" "$BASE/current.next"
mv -T "$BASE/current.next" "$BASE/current"
install -m 644 "$PREVIOUS/deploy/systemd/next-stop.service" /etc/systemd/system/next-stop.service
install -m 644 "$PREVIOUS/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl start next-stop
systemctl reload caddy 2>/dev/null || true
PREVIOUS_ID="$(sed -n 's/^RELEASE_ID=//p' "$PREVIOUS/release.env")"
if wait_healthy "$PREVIOUS_ID"; then log "rolled back to $PREVIOUS_ID"; else log "rollback also unhealthy; investigate now"; fi
exit 1
