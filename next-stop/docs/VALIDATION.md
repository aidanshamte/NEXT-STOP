# Validation record

Latest update: 2026-11-05, v0.4 source (commits `8d703a3` → `ed1481d` and docs). Each section says what kind of evidence it is.

## 1. Passed: automated tests (this workspace, Windows, Node 24.21)

`npm run lint`, `npm run typecheck`, `npm test` (**41 tests, 0 failures**), `npm run export:web`, Prettier check.

- **Accounts:** registration separate from membership; delivered-code gate; send failures never produce success; codes hashed, expiring, single-use, attempt- and resend-limited; reset revokes sessions; Google identity only after verification; no silent merge; web nonce single-use.
- **Authorization:** tenant isolation; role checks; no self-approval; parent access requires a current grant and ends on revocation; revoked members lose snapshot and GPS access; re-joining needs approval again.
- **Transport:** pickup lifecycle and invalid transitions; capacity; duplicate request rejected; GPS validation (accuracy, age, future timestamps, ordering); cannot end service with open riders; ending service clears the stored location; service cannot start on an unassigned vehicle; driver reassignment (old driver rejected, new driver accepted).
- **Realtime:** authenticated WebSocket subscription; tenant-scoped events carrying no personal data; revoked sessions closed with code 4001; data rereads after a server restart (database reopened).
- **Accounts lifecycle:** deletion requires the password; refused while on board, driving, or as the last admin; removes sessions, memberships, sharing and ride history.
- **Operations:** versioned migrations upgrade a pre-versioning database without losing rows or verifying emails, and refuse a newer schema; online backup while open in WAL mode, integrity-verified restore that keeps the prior file; Blob upload refuses non-HTTPS and SAS URLs; forwarded IP trusted only behind the proxy; per-client auth limit; per-session limit; logs contain no tokens, emails, coordinates or institution ids; `/health` returns 503 when the database is unavailable.
- **Native config:** background-location permissions and modes; local-HTTP vs HTTPS transport; Google iOS URL scheme; **preview/production builds fail without an HTTPS `EXPO_PUBLIC_API_URL`**.

Tests use synthetic identities, an injected mail-delivery function and an injected Google verifier. They do not prove live email delivery or real Google sign-in.

## 2. Passed: local integration checks (this workspace, not cloud, not phones)

- **Release package:** built with `deploy/package-release.sh`, checksum verified, unpacked to an empty directory, `npm ci --omit=dev` installed 25 packages from the server lockfile. Started with `NODE_ENV=production`: bound to 127.0.0.1, `/health` reported the release id, login failure returned 401, an unauthenticated WebSocket was closed with 4001, and logs were JSON without IPs.
- **Backup CLI:** `backup`, `verify` and `restore` against a real file; the prior database was preserved.
- **Deploy scripts:** `bash -n` syntax check on all `deploy/*.sh`. Committed with LF line endings (verified).
- **Phone-width UI (web build in headless Chrome with mobile emulation, 360×640/740 and 375×812):** sign-up screen; signed-in admin workspace; the new Dispatch revoke/assign controls; Account deletion confirmation. Scrolled frames had no horizontal overflow and no console errors after fixes. Bugs found and fixed:
  - Empty strings rendered as text inside `<View>` (a crash risk on native).
  - The stacked layout left a screen-tall gap on phones.
  - The onboarding step row did not fit small screens.
  - An empty Google container appeared when Google was not configured.

  This is a web rendering check, not a native-device check.

## 3. Not yet tested: needs the owner's accounts, money or devices

- **Azure:** not provisioned. The Bicep template was **not compiled** here (downloading the Bicep CLI was blocked); it compiles in CI (`az bicep build`) and with `az deployment group what-if`. cloud-init, Caddy certificate issuance, systemd units, Run Command deploy, managed-identity Blob access, automatic rollback on a real VM, budget and alert creation: all **untested**.
- **GitHub Actions:** workflows are committed but not pushed; none has run. Earlier CI never ran because the workflow sat under `next-stop/.github`.
- **Email:** no SMTP provider configured; no real code has been delivered.
- **Google sign-in:** no OAuth clients configured; no real Google login.
- **Native builds:** no signed APK/IPA built; no install on a phone; no GPS from a physical device; background/locked-screen tracking unverified; battery impact unknown.
- **The milestone itself (ACCEPTANCE.md):** not run.
- **Client reconnection logic:** `src/services/realtime.ts` backoff and `useLiveSnapshot` resume refresh have no automated test; they need device testing for interruptions (ACCEPTANCE #8–9).
- **Push notifications:** not implemented.
- **Restore drill on the VM:** not run.

## Exact next steps for the owner

1. Review the costs in DEPLOY-AZURE.md (about $7/month while the VM is free) and decide whether to provision.
2. Install the Azure CLI, then follow DEPLOY-AZURE.md steps 1–5 (region check, SSH key, parameters, `what-if`, deploy, secrets via `sudoedit` on the VM).
3. Set up an email sender (Azure Communication Services Email, or another SMTP provider) and Google OAuth clients (AUTH-SETUP.md).
4. Choose permanent app identifiers in `app.config.ts`.
5. First deploy over SSH (step 6), create the institution (step 7), set `EXPO_PUBLIC_API_URL` in EAS (step 8).
6. Build the Android `preview` APK (and iOS if you have Apple Developer access) and run ACCEPTANCE.md on two phones on different networks.
7. Push to GitHub when ready; CI then compiles the Bicep template and runs everything above.
8. Record each result in this file, with dates and devices.
