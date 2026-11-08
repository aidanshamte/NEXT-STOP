# Validation record

Latest update: 2026-11-06. Each section says what kind of evidence it is.

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

## 2b. Passed: real Azure deployment (2026-11-06, observed from outside Azure)

- **Provisioned** `nextstop-pilot` in North Central US from `deploy/azure/main.bicep`; `what-if` reviewed first; deployment state `Succeeded`. Subscription: Azure for Students, spending limit On; about $90.64 credit at the time.
- **VM bootstrap:** cloud-init `done` with no errors; Node 24.22, Caddy 2.11. The database mount `/var/lib/next-stop` is the 8 GiB persistent data disk on LUN 0 (no temporary disk on this size).
- **Public HTTPS:** `https://nextstop-api.northcentralus.cloudapp.azure.com/health` → `{"ok":true,...,"schema":3}`. Let's Encrypt certificate for the hostname, valid until 2027-02-04. HTTP redirects with 308; HSTS present.
- **Secure WebSocket:** `wss://…/realtime` connected over TLS from this workstation; an invalid token was closed with 4001.
- **Deploys:** first release over SSH (`release.sh`: checksum, migration 0→3, healthy). Then three GitHub Actions runs of _Deploy API (Azure)_ succeeded end to end: OIDC login, Blob upload, Run Command install, and a public `/health` check of the new release id. The first run failed on the OIDC subject format (fixed; see DEPLOY-AZURE.md).
- **Backups:** the systemd backup wrote a verified local copy and uploaded it to Blob storage with the managed identity ("Backup uploaded to Azure Blob Storage"). The daily timer is scheduled.
- **Restore drill on the VM:** with the documented command, a verified backup was restored, the prior database was kept as `next-stop.db.pre-restore-…`, and the service returned healthy. This drill found and fixed a real bug: the CLI silently did nothing when run through the release symlink. A regression test was added.
- **Email provider wiring:** on the VM, the managed identity obtained a token and ACS accepted and completed a send to a reserved test address (`example.com`). Delivery to a real inbox: see section 3.

## 2c. Passed: web testing version at https://nextstop.software (2026-11-06)

`node scripts/verify-web.mjs`, run from outside Azure: **17/17 checks passed**.

- DNS: the apex and `www` resolve to the VM's static IP 52.159.95.124 (Name.com nameservers unchanged).
- Let's Encrypt certificates for `nextstop.software`, `www.nextstop.software` and the Azure hostname (renewed automatically by Caddy).
- `www` redirects with 301 to the apex, keeping the path and query; HTTP redirects to HTTPS.
- The site returns the app with CSP and HSTS; deep links return the app; hashed bundles are cached as immutable.
- API paths on the web origin return JSON (including unknown API paths). Sign-in answers the site origin with 401 for bad credentials; other origins get 403.
- `wss://nextstop.software/realtime` rejects an invalid token with 4001, and a foreign origin is refused. The mobile hostname's `/health` and WSS still work.
- Headless Chrome with phone emulation (375 px): the page renders with no console errors, CSP violations or failed requests. A deep link and an old `www` link open the app (a not-found redirect was added after this check first showed Expo Router's "Unmatched Route" page).

**Not verified by me:** signing in on the website with a real account, live updates between two signed-in sessions, and reconnection after a network drop in the browser (these need the owner's account; the reconnect logic has automated server-side coverage only). Google sign-in on the web needs the Web OAuth client with origin `https://nextstop.software`.

## 2d. Passed: interface redesign from the Stitch reference (2026-11-06, local, web rendering only)

Test environment: a throwaway local database labelled "Test College" (never deployed), the API on port 4100 and the Expo web build in headless Chrome with phone emulation. `npm test`: **71 tests, 0 failures**, plus lint, typecheck, Prettier and a web export that includes `map.html`.

- **Before/after at 375 px** for student (pickup form and active request), driver, parent and dispatch: no horizontal overflow, no console errors. Also checked at 320 px, at 250 px (a 375 px phone at 150% zoom) and at 1280 px desktop width.
- **Website map:** previously one generic OpenStreetMap pin and no stops. It now uses the same MapLibre document as the native app (`public/map.html`, generated from `src/components/mapHtml.ts`, pinned with subresource integrity, sandboxed without same-origin access). Inside the frame, DevTools confirmed 4 confirmed stops, the vehicle and a fitted camera.
- **Bug found and fixed:** the map frame waited for MapLibre's `load` event, which never fired here, so no data reached it. The frame now accepts data as soon as the map exists.
- **Production map frame (after deploy, release `f89e32e`):** on https://nextstop.software the app's sandboxed `/map.html` frame was given test points in the browser only (nothing stored). Result: frame origin `null`, `sessionStorage` blocked, MapLibre loaded through its integrity check, style and map tiles loaded around Fairfield University, markers and vehicle drawn, no CSP violations. `node scripts/verify-web.mjs`: 17/17.
- **Two bugs found by that check and fixed:** (1) MapLibre discarded every tile reply in an opaque-origin frame (its worker-message origin check; the page and its blob worker report different origins), and reading `caches` throws there. Both are adjusted only when the frame is sandboxed. (2) The map frame's CSP then needed `blob:` in `script-src` for MapLibre's own worker code.
- **Pickup lifecycle through the real UI** in two tabs (rider and driver): request (tapped three times, with 1.5 s simulated latency) showed _Sending request…_ and created exactly one request. Accept → Approaching → Boarding → Drop-off each reached the rider in 230–280 ms over the live connection with no reload; the rider then returned to the pickup form.
- **Bug found and fixed:** the rider's pending label never showed because the in-flight key included the shuttle id; a regression test covers it.
- **Connection states:** DevTools network emulation took the rider offline, then back online. The header went _Live_ → _Offline · data from 17s ago_ (with the existing notice) → _Live_ again without a refresh. A vehicle fix set two minutes old showed _last GPS 2 min ago_ in amber with a grey marker.

**Not verified:** the redesign on a physical phone (native WebView map, VoiceOver/TalkBack, OS-level dynamic type), and signing in to the live website with a real account to see real Fairfield data on the new screens.

## 2e. Passed: Stitch functionality, stages 1–3 (2026-11-07, local web; production noted below)

Test environment: a throwaway scratchpad database ("Test Institution", "Test Stop A–D", test accounts), API on port 4100 running schema 7, Expo web on 8099, headless Chrome at 375 px and 320 px. Checklist with per-item evidence: FEATURES.md.

- **Automated:** `npm test` **126 tests, 0 failures** (new: `service.test.mjs`, `eta.test.mjs`, `safety.test.mjs`, `client-logic.test.mjs`; route proxy test now scans every server module). Lint, typecheck, Prettier. `expo export` for iOS and Android bundles the new camera, image and QR modules (bundling only, not a device run).
- **Stage 1 in the browser:** admin saved time zone and 15-minute expiry, vehicle capacity and ramp, stop details and verification, a service period, 15-minute departures and a closure, and a route alert, all through the forms. Rider saw the alert banner, seats estimate, "I’m waiting at Test Stop A", then "You and 1 other rider waiting here" when a second rider joined, with no reload. A second rider's unaccepted request, aged past the window, was cancelled by the server timer and the rider saw "was cancelled: not accepted in time" after 43 s without a reload. Stop page showed verification, scheduled times, amenities and photo; schedules showed "7:00 AM – 10:00 PM · 61 departures · about every 15 min" and "Live: 1 shuttle in service".
- **Stage 2 in the browser:** with test travel-time rows in the throwaway database, three real-time GPS fixes from stop A to stop B made the server record progress and set the approach flag, and the rider saw "Live estimate: 4–5 min" with its basis ("last 4 trips … Last passed Test Stop B just now"). Before any passage it read "Live estimate unavailable · The shuttle’s GPS is not current."
- **Stage 3 in the browser:** with everything off, Safety showed only "Call your local emergency number". After the admin turned features on: the rider's pass drew a QR and a typed code; the driver's typed check returned "Valid · Test" and "Confirm boarding at Test Stop A", which boarded the rider; a wrong code was rejected. Report and escort requests showed "Waiting for staff…" until the admin acknowledged and accepted in Alerts, then "Received by staff" and "Accepted by staff" appeared on the rider's screen live. A one-ride share showed the journey to the parent, who saw "Students sharing with you: Test" and stopped following; the journey disappeared. Two riders matched for a shared ride ("1 other rider making this trip") and, after both chose to coordinate, saw only a first name.
- **Bugs found and fixed during these runs:** checkboxes, radio buttons and tabs exposed no checked/selected state to web screen readers (now `aria-checked`/`aria-selected`); drop-off choices had no accessible name distinct from pickup choices; the stop page offered "I’m waiting here" to a rider who already had a pickup; the route lookahead could revisit the stop just passed; new API routes were not yet proxied by Caddy on the shared website origin (caught by the route test).
- **Layout:** page width equals the viewport on every screen for all five roles (horizontal scrolling only inside the stop strip, by design); no console errors.

- **Production (release `e83dc68125e2`, 2026-11-07):** the "Deploy API (Azure)" workflow and CI succeeded. `/health` reports schema 7 and the release; the institution list still returns Fairfield University after migrations 5–7. All 32 new routes reach the API from https://nextstop.software (signed out they return 401 JSON, not the web page). `node scripts/verify-web.mjs`: 17/17. The live web route bundle contains the new screens. No signed-in production session was used, and no feature was turned on for Fairfield: every stage 3 feature is still off there.

**Not verified:** camera scanning, photo picking, tap-to-call/text, push delivery of the new notifications and the native map on a physical phone; arrival-estimate accuracy on real service (needs pins, routes and days of operation).

## 2f. Passed: boarding-point suggestions and estimate accuracy (2026-11-08)

- **Automated:** `npm test` **144 tests, 0 failures** (new: `suggestions.test.mjs`; accuracy test in `eta.test.mjs`). Lint, typecheck, Prettier. The accuracy test caught a real bug before release: arrival times were stored in milliseconds and compared with ranges in seconds, so nothing counted as within range; another fix ends unresolved checks when service ends.
- **Local browser** (throwaway database; a test institution named "Fairfield University" with the shipped route import; test accounts; 375 px): **Setup** showed "21 draft stops have a researched location", Barone Campus Center Traffic Circle first with "High confidence", its evidence, source and a map pin on the Loyola Drive loop. **Skip for now** moved to "2 of 21"; **Approve suggested location** confirmed Walsh Lot Crosswalk, the count fell to 20, the rider's snapshot then listed that stop (no suggestion or pin-source fields), and the route list showed "Approved suggestion (low confidence) …". Blocks 13 and 17 were listed under "No suggestion found". The accuracy card read "No measured arrivals yet … must not be described as accurate". No overflow, no console errors.
- **Production (release `86ae193919b1`):** deploy workflow and CI succeeded; `/health` schema 8; Fairfield University still listed; 34/34 new routes return 401 JSON signed out; `verify-web.mjs` 17/17; the live route chunk contains both new cards. No signed-in production session was used. Production stops were not read or changed: approving suggestions is left to the administrator.
- **Expo Go:** restarted with `--go --tunnel` on port 8082; the tunnel served the manifest and a 7.5 MB Android bundle built from the current code.
- **Android preview builds:** 0.5.0 (versionCode 2, commit `5b7175a`) finished; 0.5.1 (versionCode 3, includes the review and accuracy cards) built from `13547a1`. Neither contains Firebase configuration, so Android push cannot be received yet.

**Not verified:** any physical-phone behavior (ACCEPTANCE.md, including feature checks F1–F6); whether any suggested point is where Fairfield shuttles actually stop; estimate accuracy on real service.

## 3. Not yet tested: needs the owner's accounts, money or devices

- **Automatic rollback on a failing release** has not been triggered on the VM (only healthy releases were deployed). Budget/alert emails have not fired.
- **Email to a real inbox:** not yet confirmed. The first real signup will show it.
- **Google sign-in:** no OAuth clients configured; no real Google login.
- **Native builds:** no signed APK/IPA built; no install on a phone; no GPS from a physical device; background/locked-screen tracking unverified; battery impact unknown.
- **The milestone itself (ACCEPTANCE.md):** not run.
- **Client reconnection logic:** `src/services/realtime.ts` backoff and `useLiveSnapshot` resume refresh have no automated test; they need device testing for interruptions (ACCEPTANCE #8–9).
- **Push notifications:** not implemented.

## Exact next steps for the owner

1. Review the costs in DEPLOY-AZURE.md (about $7/month while the VM is free) and decide whether to provision.
2. Install the Azure CLI, then follow DEPLOY-AZURE.md steps 1–5 (region check, SSH key, parameters, `what-if`, deploy, secrets via `sudoedit` on the VM).
3. Set up an email sender (Azure Communication Services Email, or another SMTP provider) and Google OAuth clients (AUTH-SETUP.md).
4. Choose permanent app identifiers in `app.config.ts`.
5. First deploy over SSH (step 6), create the institution (step 7), set `EXPO_PUBLIC_API_URL` in EAS (step 8).
6. Build the Android `preview` APK (and iOS if you have Apple Developer access) and run ACCEPTANCE.md on two phones on different networks.
7. Push to GitHub when ready; CI then compiles the Bicep template and runs everything above.
8. Record each result in this file, with dates and devices.
