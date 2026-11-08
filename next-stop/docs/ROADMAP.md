# NEXT STOP implementation checklist

The living task list. Update it in the same commit as the work. Mark an item `[x]` only with evidence (a test, or a recorded device/provider result in VALIDATION.md). Last updated: 2026-11-08.

## Milestone 1: real pickup + real GPS between two installed phones via Azure

Goal: a verified student and an approved driver, using installed apps on separate networks, exchange a real pickup request and genuine shuttle location through an Azure-hosted backend with persistent accounts.

### Done in source, automated tests passing

- [x] Accounts: register, verify email by code, sign in, reset, sign out, persistent server sessions, SecureStore on device
- [x] Google ID tokens verified server-side; no silent account merge
- [x] Institution join requests; admin approval; no self-granted driver/admin
- [x] Tenant isolation and role checks on every endpoint and on WebSocket subscription
- [x] Pickup lifecycle (requested → accepted → boarded → arrived / cancelled), capacity, one open request per student
- [x] Driver GPS validation (accuracy ≤ 100 m, fresh timestamps, ordering); stale/offline display
- [x] Authenticated realtime invalidation, reconnect with backoff, resync on reconnect/resume
- [x] Parent sharing by explicit student grant; immediate revocation
- [x] Versioned migrations; backup/verify/restore tooling (tested)
- [x] Admin revoke access and reassign driver; account deletion (in-app)
- [x] Location minimization: latest position only, discarded when service ends
- [x] Privacy-safe JSON request logs; DB-checked `/health` with release id
- [x] Proxy-aware auth rate limits; per-session request limit
- [x] Azure infrastructure as code, VM bootstrap, systemd, Caddy HTTPS/WSS, backups to Blob
- [x] Release packaging, health-gated deploy with automatic rollback, manual rollback script
- [x] GitHub Actions: CI at repo root, OIDC deploy workflow, hourly uptime check
- [x] Preview/production builds refuse to build without an HTTPS API URL
- [x] Phone-width UI check (web, 360/375 px): fixed overflow-free layout, empty-text-node crash risk, stacked-column gap

### Blocked on the owner (accounts, money, devices); see "Exact next steps" in VALIDATION.md

- [ ] Approve the Azure cost estimate, then provision (DEPLOY-AZURE.md steps 1–4)
- [ ] Confirm the Bicep template compiles (`az bicep build`; also runs in CI). Not compiled here: downloading the Bicep CLI was blocked in this session
- [ ] Choose an email provider and put SMTP credentials on the VM (Azure Communication Services or another SMTP sender)
- [ ] Google Cloud project: OAuth clients (web, Android with signing SHA-1; iOS later) and Firebase for Android push. No Maps key is needed (MapLibre + OpenFreeMap)
- [ ] Choose permanent app identifiers (replace the `com.nextstop.app` placeholder)
- [ ] Expo account + `eas init`; Apple Developer Program membership for iPhone installs
- [ ] First deploy; restore drill on the VM; record results
- [ ] Build `preview` for Android (and iOS) and run ACCEPTANCE.md on two phones on different networks
- [ ] Push the local commits to GitHub so CI runs (the owner decides when)

## Fairfield University routes (imported 2026-11-06)

- [x] Four services imported from the posted sign in printed order (Campus 13 incl. repeated Barone visit and on-demand 10-13, Town 9, Bellarmine 3, 1720 Post Road 2): 23 unique stops, all **drafts**
- [ ] Confirm each boarding point in Dispatch → Routes and stops (stand at the stop, use GPS). No authoritative coordinates were available, so no pins were guessed
- [ ] Decide whether the existing manual stop "The Circle" is the Barone Campus Center Traffic Circle (if so, pin Barone there and retire the manual stop)
- [ ] Assign each shuttle its route
- Schedules, driving paths and arrival estimates are deliberately not imported

To re-import after the sign changes: edit `server/imports/fairfield-university-shuttles.json`, deploy, then on the VM run `node server/import-routes.mjs --institution <id> --file server/imports/fairfield-university-shuttles.json --dry-run` and then without `--dry-run`. Confirmed stops are never changed by an import.

## Milestone 2: rider experience and notifications

- [x] "Approaching" status that the driver sets explicitly (`push.test.mjs`)
- [x] Push notifications through Expo Push Service with receipt checks and token cleanup (`push.test.mjs`). Delivery to real phones still needs the Android FCM key and device tests
- [x] Rider-visible capacity: driver-confirmed onboard count (boarded/arrived events, driver correction) plus accepted pickups, labelled as an estimate (`service.test.mjs`, FEATURES.md 1.6–1.8)
- [x] Service alerts managed by admins (per route or institution), pushed by preference; driver delay reports alongside (`service.test.mjs`)
- [x] Notification preferences per institution, followed routes, saved stops (`service.test.mjs`)
- [ ] Driver one-tap UI review: large targets, minimal typing while in service
- [ ] Session management screen (list and revoke devices); change password while signed in
- [x] Request timeout / no-show handling with reasons (`service.test.mjs`; live expiry seen in the browser, VALIDATION 2e)
- [x] Arrival estimates from stop-passage travel-time history, with ranges and "unavailable" states (`eta.test.mjs`, `client-logic.test.mjs`). Accuracy on real Fairfield service is not yet measured: it needs confirmed stop pins, assigned routes and several days of service
- [x] Stop-approach notifications 1–3 stops before the rider's stop (`eta.test.mjs`)

## Milestone 3: institution operations

- [x] Routes (ordered stops); institution timetables: service periods, departures, stop times, closures and notes, time zone (`service.test.mjs`)
- [x] Stop details: description, accessibility, amenities, photo, administrator verification (`service.test.mjs`)
- [x] Researched boarding-point suggestions for Fairfield's 23 stops, approved with one tap by an administrator (`suggestions.test.mjs`, FAIRFIELD-STOPS.md)
- [ ] Approve or correct the 21 Fairfield suggestions and pin Blocks 13 and 17 on site (administrator)
- [ ] Archive stops; enter Fairfield's real timetable (FAIRFIELD-TIMETABLE.md lists the missing effective dates and times)
- [x] Arrival-estimate accuracy measured against real passages, shown to administrators (`eta.test.mjs`)
- [ ] Measure accuracy on real Fairfield service (ACCEPTANCE.md pass criteria) before calling estimates accurate
- [x] Capacity and features per vehicle (`service.test.mjs`). A separate vehicle registry is still open
- [ ] Institution invitation codes or verified email domains for faster, still admin-controlled, approval
- [ ] Demand review: requests by stop and time; service activity history with a defined retention period
- [ ] Audit log of admin actions (approvals, revocations, assignments)
- [ ] Optional ETA through a documented provider (for example Azure Maps Route), shown with uncertainty and with cost noted

## Milestone 4: passes, safety and coordination (all off by default per institution)

- [x] Rotating QR rider pass and driver/dispatch validation with audit and guessing limits (`safety.test.mjs`)
- [ ] NFC tap and Apple/Google Wallet passes: need an Apple Pass Type ID certificate, a Google Wallet issuer account and, for NFC, Apple's NFC pass entitlement and compatible readers on vehicles
- [x] Journey sharing for one ride or a set time; student stop-all; parent can leave (`safety.test.mjs`)
- [x] Institution safety contacts and emergency number (tap to call; nothing sent through NEXT STOP)
- [x] In-app reports and escort requests answered by staff in NEXT STOP (`safety.test.mjs`); turn on only when staff will monitor them
- [x] Opt-in shared-ride coordination with first names only, reports and blocking (`safety.test.mjs`); no provider booking or prices
- [ ] Institution SSO (OIDC/SAML): needs the institution's identity provider registration (issuer, client ID, approved redirect URIs)
- [ ] Payments: not applicable while shuttles are free; needs a fare policy and a payment provider account before any work

## Scaling path (only when needed)

- [ ] PostgreSQL (Azure Database for PostgreSQL Flexible Server) with an async data layer and a migration that copies existing SQLite accounts and records
- [ ] Shared realtime fan-out (PostgreSQL LISTEN/NOTIFY or Azure Web PubSub) before running more than one instance
- [ ] Key Vault for server secrets; custom domain

## Design system

- [x] Palette (midnight navy, coral, warm white, mint), type and components in code; documented in BRAND.md
- [x] Rider, driver, parent and dispatch screens restyled from the owner's Stitch reference (2026-11-06); see the layout section of BRAND.md
- [ ] Figma file: not created. No Figma connection was available in this session. If one is created, link it in BRAND.md
- [ ] Accessibility audit on devices (screen readers, dynamic type, contrast checks)

## Unresolved requirements: need decisions or legal/institutional review

Nothing below is legal advice, and nothing generated here is an approved policy.

- **Minors:** K-12 use may involve children under 13 (COPPA in the US) and student education records (FERPA when data is created on a school's behalf). Decide the minimum supported age and whether accounts for minors are created by the institution, not self-registered.
- **Institutional agreement:** a data processing / privacy agreement with each pilot institution; who approves drivers (background checks are the institution's responsibility).
- **Privacy policy and terms:** required by both stores and for any pilot. Must describe driver location collection (only during active service), retention (latest point only; backups kept 35 days), parent sharing, and deletion.
- **Store disclosures:** Google Play background-location declaration and video showing the feature; Play Data safety form; Apple App Privacy labels and a clear "Always" location justification; in-app account deletion (implemented).
- **Personal student location:** not collected. If ever added, it must be a separate, explicit, revocable permission with visible status and its own retention rule.
- **Emergency use:** NEXT STOP is not an emergency or dispatch service, and the app must not imply that it is.
