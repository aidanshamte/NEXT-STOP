#!/usr/bin/env bash
# Builds the server release package: server code + its lockfile + deploy config.
# The mobile app, Expo and React Native are not part of the server package.
#   deploy/package-release.sh <release-id> [output-dir] [web-build-dir]
# The optional web build (npx expo export --platform web) is served at the web domain.
set -euo pipefail
RELEASE="${1:?usage: package-release.sh <release-id> [output-dir]}"
[[ "$RELEASE" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid release id" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "${2:-$ROOT/build/release}" && cd "${2:-$ROOT/build/release}" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server" "$STAGE/deploy"
cp "$ROOT"/server/*.mjs "$ROOT"/server/*.json "$STAGE/server/"
# Institution data import files (public route/stop lists; no personal data).
cp -R "$ROOT/server/imports" "$STAGE/server/imports"
cp -R "$ROOT/deploy/systemd" "$ROOT/deploy/Caddyfile" "$ROOT/deploy/release.sh" "$ROOT/deploy/rollback.sh" "$STAGE/deploy/"
WEB="${3:-$ROOT/build/web}"
PARTS=(server deploy)
if [[ -f "$WEB/index.html" ]]; then
  cp -R "$WEB" "$STAGE/web"
  PARTS+=(web)
fi
tar -czf "$OUT/$RELEASE.tgz" -C "$STAGE" "${PARTS[@]}"
(cd "$OUT" && sha256sum "$RELEASE.tgz" >"$RELEASE.tgz.sha256")
echo "$OUT/$RELEASE.tgz"
