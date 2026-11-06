# Working on NEXT STOP

Read README.md, docs/AUTH-SETUP.md, docs/PHONE-INSTALL.md and docs/ARCHITECTURE.md first. This is a real, multi-institution shuttle app with a local-capable server, not a demo.

## Commands

Use Node 24+, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run export:web`. Native JS export: `npx expo export --platform ios --platform android --output-dir build/native`. Build and device acceptance are separate checks.

## Invariants

- Do not reintroduce simulated buses, fictional operational data, role-switch demo controls, or invented ETA. Test fixtures belong under tests only.
- Every operation authenticates and checks institution membership/role server-side. Driver approval and vehicle assignment are separate.
- Parent visibility requires a current student-owned grant. Revocation is enforced by API reads; realtime events contain no sensitive rider payloads.
- Never render the previous institution's snapshot during a tenant switch.
- Never end service with open requests or onboard riders.
- Native GPS uses the module-scope background task. Backgrounding alone must not stop an active service's tracking. Sign-out, server/institution/vehicle switch and successful service end must stop it.
- Store mobile sessions/tracking context in SecureStore, not AsyncStorage or committed files. Never send old server credentials to a newly selected server.
- Local HTTP is opt-in internal-build configuration; production uses HTTPS. Keep native transport config tests passing.
- No claim of tested background reliability, fixed GPS cadence, push delivery, ETA, emergency service or store readiness without corresponding evidence.
- Add regression tests for authorization, realtime delivery, and lifecycle changes. Run lint/types/tests after changes. No real credentials, databases, or student records in Git.

## Expo conventions

Check package.json's Expo major and matching versioned docs before changing Expo/React Native APIs; use https://docs.expo.dev/llms.txt as index. Install native modules with `npx expo install`. Expo Router entry/layout lives in src/app; feature code belongs elsewhere. Configure native behavior through app.config.ts/plugins, not hand-edited generated ios/android trees. Use `npx eas-cli@latest` for cloud build/sign/submit commands.

## Next work

docs/ROADMAP.md is the living checklist: read it first and update it in the same commit as your work. The current goal is Milestone 1: deploy the API to Azure (docs/DEPLOY-AZURE.md), build `preview` apps, and run docs/ACCEPTANCE.md on two phones on different networks. Record evidence in docs/VALIDATION.md. Do not substitute bundling, web rendering or mocked providers for device/provider results.

## Hosted deployment invariants

- The API runs as exactly one instance (in-memory realtime hub and limits). Do not add instances, autoscaling or a second VM without first adding shared event distribution.
- SQLite stays on the attached data disk (`/var/lib/next-stop`), never on Azure Files/SMB or App Service storage.
- Schema changes go in `server/db.mjs` as a new migration step appended to the list; never edit an applied step. Existing rows must survive. Add a test.
- `server/package.json` + lockfile are what the VM installs. Add server runtime dependencies there (and at root for tests).
- Never log tokens, IPs, request bodies, query strings, emails or coordinates. `tests/operations.test.mjs` checks this.
- Secrets live only in `/etc/next-stop/next-stop.env` on the VM. Do not provision, deploy, push, or create billable resources without the owner's explicit approval.
- Deploy scripts must keep LF line endings (.gitattributes) and pass `bash -n` and shellcheck in CI.

## Authentication and onboarding

- Normal users create/sign in to accounts, verify their email, then choose a role and join an institution. Never reintroduce server entry in user onboarding.
- SMTP and Google require real team-provided configuration. Never fake provider success, return OTPs to clients, log codes, or mark email verified without proof.
- Codes expire, are hashed, rate-limited and consumed once. Reset revokes all sessions. Google tokens must pass backend verification; do not merge an existing email account silently.
- Google native SDK and background GPS need installed native builds. Do not claim live-provider or device validation from mocked-provider tests or bundling.
- Existing data must survive migrations. Never overwrite .env, delete databases or automatically mark migrated emails verified.
