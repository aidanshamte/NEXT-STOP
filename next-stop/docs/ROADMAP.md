# NEXT STOP implementation checklist

The living task list. Update it in the same commit as the work. Mark an item `[x]` only with evidence (a test, or a recorded device/provider result in VALIDATION.md). Last updated: 2026-11-05.

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
- [ ] Google Cloud project: OAuth clients (web, iOS, Android with signing SHA-1) and Maps SDK for Android key
- [ ] Choose permanent app identifiers (replace the `com.nextstop.app` placeholder)
- [ ] Expo account + `eas init`; Apple Developer Program membership for iPhone installs
- [ ] First deploy; restore drill on the VM; record results
- [ ] Build `preview` for Android (and iOS) and run ACCEPTANCE.md on two phones on different networks
- [ ] Push the local commits to GitHub so CI runs (the owner decides when)

## Milestone 2: rider experience and notifications

- [ ] "Approaching" status that the driver sets explicitly (no inferred ETA). Students see driver-set states only
- [ ] Push notifications through Expo Push Service (APNs/FCM) for accepted/approaching/boarded/arrived/delay; store device tokens per session; delete them on sign-out and account deletion; durable outbox with receipt checks. Never claim guaranteed delivery
- [ ] Rider-visible capacity ("seats available"), computed from accepted + boarded counts
- [ ] Service alerts managed by admins; driver issue reports flow into them
- [ ] Driver one-tap UI review: large targets, minimal typing while in service
- [ ] Session management screen (list and revoke devices); change password while signed in
- [ ] Request timeout / no-show handling with reasons

## Milestone 3: institution operations

- [ ] Routes (ordered stops), service schedules and operating hours; edit/archive stops
- [ ] Vehicles separate from trips (vehicle registry, capacity per vehicle)
- [ ] Institution invitation codes or verified email domains for faster, still admin-controlled, approval
- [ ] Demand review: requests by stop and time; service activity history with a defined retention period
- [ ] Audit log of admin actions (approvals, revocations, assignments)
- [ ] Optional ETA through a documented provider (for example Azure Maps Route), shown with uncertainty and with cost noted

## Scaling path (only when needed)

- [ ] PostgreSQL (Azure Database for PostgreSQL Flexible Server) with an async data layer and a migration that copies existing SQLite accounts and records
- [ ] Shared realtime fan-out (PostgreSQL LISTEN/NOTIFY or Azure Web PubSub) before running more than one instance
- [ ] Key Vault for server secrets; custom domain

## Design system

- [x] Palette (midnight navy, coral, warm white, mint), type and components in code; documented in BRAND.md
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
