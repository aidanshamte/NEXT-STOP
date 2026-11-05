# NEXT STOP roadmap

## Implemented in v0.2

- [x] Real server connection as the only app runtime; no demo data feed
- [x] Real institution/admin bootstrap with empty initial database
- [x] Actual registration, approval, institution-scoped roles and assigned drivers
- [x] Administrator stop creation using actual coordinates and shuttle assignment
- [x] Persistent pickup/acceptance/boarding/drop-off lifecycle and capacity protection
- [x] Student-authorized parent trip sharing and revocation
- [x] Authenticated WebSocket invalidation, reconnection and recovery refresh
- [x] Native driver background-location task, permissions and tracking indicators
- [x] Local-network HTTP internal build profiles and HTTPS production profile
- [x] Device-install guide for both Android and iPhone
- [x] HTTP/WS integration, authorization, persistence and native-config tests

## Next acceptance gate: physical phones

- [ ] Create a team-owned Expo project/signing setup and configure Android map key
- [ ] Build/install signed Android and iOS apps
- [ ] Complete the actual two-phone journey in PHONE-INSTALL.md
- [ ] Record foreground/locked-screen location lag, battery usage, permission recovery and disconnect behavior
- [ ] Verify Wi-Fi/server interruption shows stale GPS and reconnects correctly
- [ ] Verify the installed local-network build does not depend on Metro

These are not marked complete by bundling or server tests.

## Service maturity

- [ ] Separate route definitions/order per trip, service scheduling, driver reassignment and stop editing
- [ ] Request timeout, rejection/no-show reasons, vehicle capacity visibility for riders
- [ ] Route-aware ETA and operating rules for skipping unrequested stops while preserving drop-offs
- [ ] Push notification delivery with durable outbox/receipts; incident escalation approved by operator
- [ ] Permission/error telemetry, native task recovery, durable location/event processing where needed
- [ ] Account recovery, email/SSO verification, suspension, session management, audit logs
- [ ] Managed database with versioned migrations, tenant constraints, backups and restore drills
- [ ] UI feature extraction, interaction tests and accessibility audit

## School-specific requirements

- [ ] Verified guardianship and school-managed child profiles
- [ ] Approved handover contacts, boarding identity and exception workflows
- [ ] Retention/deletion and institution privacy requirements

## Public release

- [ ] Production HTTPS hosting, monitoring, support ownership and operational pilot approval
- [ ] Real-device QA, load/security/accessibility review
- [ ] Accurate privacy disclosures, support/deletion workflows and store assets
- [ ] Signed production builds, internal TestFlight/Android testing, store submission and review

No cloud deployment, store approval, or fleet-scale reliability claim is implied by the source implementation.
