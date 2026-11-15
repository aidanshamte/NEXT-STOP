#!/usr/bin/env bash
# Manually switches NEXT STOP back to an earlier installed release.
#   rollback.sh             -> the most recent release other than the current one
#   rollback.sh <release>   -> a specific release directory under /opt/next-stop/releases
# Code rollback only. If the newer release migrated the database schema, the older
# code refuses to start; restore the matching pre-deploy backup first:
#   sudo -u nextstop env DATABASE_PATH=/var/lib/next-stop/next-stop.db \
#     node /opt/next-stop/releases/<older>/server/backup.mjs restore --file <backup.db>
set -euo pipefail
BASE=/opt/next-stop
CURRENT="$(readlink -f "$BASE/current")"
if [[ -n "${1:-}" ]]; then
  [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid release id" >&2; exit 2; }
  TARGET="$BASE/releases/$1"
else
  TARGET="$(ls -1dt "$BASE"/releases/*/ | sed 's:/$::' | while read -r d; do
    [[ "$(readlink -f "$d")" != "$CURRENT" ]] && { echo "$d"; break; }
  done)"
fi
[[ -d "$TARGET" ]] || { echo "No release to roll back to." >&2; exit 1; }
ID="$(sed -n 's/^RELEASE_ID=//p' "$TARGET/release.env")"
echo "Rolling back from $(basename "$CURRENT") to $ID"
ln -sfn "$TARGET" "$BASE/current.next"
mv -T "$BASE/current.next" "$BASE/current"
install -m 644 "$TARGET/deploy/systemd/next-stop.service" /etc/systemd/system/next-stop.service
systemctl daemon-reload
systemctl enable next-stop >/dev/null 2>&1
systemctl restart next-stop
for _ in $(seq 1 30); do
  if curl -sSf http://127.0.0.1:4000/health | grep -q "\"release\":\"$ID\""; then
    echo "Rollback healthy on $ID"
    exit 0
  fi
  sleep 1
done
echo "Release $ID did not become healthy. Check: journalctl -u next-stop -n 80" >&2
exit 1
