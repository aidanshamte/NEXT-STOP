#!/usr/bin/env bash
# Builds the server release package: server code + its lockfile + deploy config.
# The mobile app, Expo and React Native are not part of the server package.
#   deploy/package-release.sh <release-id> [output-dir]
set -euo pipefail
RELEASE="${1:?usage: package-release.sh <release-id> [output-dir]}"
[[ "$RELEASE" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "Invalid release id" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "${2:-$ROOT/build/release}" && cd "${2:-$ROOT/build/release}" && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/server" "$STAGE/deploy"
cp "$ROOT"/server/*.mjs "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$STAGE/server/"
# Institution data import files (public route/stop lists; no personal data).
cp -R "$ROOT/server/imports" "$STAGE/server/imports"
cp -R "$ROOT/deploy/systemd" "$ROOT/deploy/Caddyfile" "$ROOT/deploy/release.sh" "$ROOT/deploy/rollback.sh" "$STAGE/deploy/"
tar -czf "$OUT/$RELEASE.tgz" -C "$STAGE" server deploy
(cd "$OUT" && sha256sum "$RELEASE.tgz" >"$RELEASE.tgz.sha256")
echo "$OUT/$RELEASE.tgz"
