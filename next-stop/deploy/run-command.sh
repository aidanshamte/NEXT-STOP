#!/usr/bin/env bash
# Executed on the VM by `az vm run-command invoke` from the deploy workflow.
# __RELEASE__ is substituted before sending. Downloads the release with the VM's
# managed identity and hands it to that release's own release.sh.
set -euo pipefail
RELEASE=__RELEASE__
cloud-init status --wait >/dev/null || true
test -f /var/log/next-stop-bootstrap.done || { echo "VM bootstrap has not completed" >&2; exit 1; }
# shellcheck source=/dev/null
source /etc/next-stop/deploy.env
TOKEN="$(curl -sSf -H Metadata:true \
  "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).access_token))')"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
for name in "$RELEASE.tgz" "$RELEASE.tgz.sha256"; do
  curl -sSf -H "Authorization: Bearer $TOKEN" -H "x-ms-version: 2021-08-06" \
    "$RELEASE_CONTAINER_URL/$name" -o "$T/$name"
done
tar -xzf "$T/$RELEASE.tgz" -C "$T" deploy/release.sh
bash "$T/deploy/release.sh" "$RELEASE" "$T/$RELEASE.tgz" 2>&1 | tail -n 60
