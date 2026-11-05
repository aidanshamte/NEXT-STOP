# Working on NEXT STOP

Read README.md, docs/PHONE-INSTALL.md and docs/ARCHITECTURE.md first. This is a real, multi-institution shuttle app with a local-capable server, not a demo.

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

Follow docs/ROADMAP.md. First get signed native builds onto both physical devices and run the actual journey/lock-screen/disconnect acceptance test. Do not substitute bundling for device results. Continue extracting App.tsx into feature screens without changing authorization or transport behavior.
