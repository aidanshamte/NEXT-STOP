# NEXT STOP

**Your ride. In sight.**

A school and college shuttle app with actual accounts, institution permissions, pickup requests, driver GPS, parent-authorized trip sharing, and an authenticated live connection. **There is no demo mode or simulated vehicle feed.** A new database is empty until you create your institution and register people.

The server can run on your computer. Android and iPhone apps connect to it over the same Wi-Fi; a public cloud backend is not required for that local test. Physical-device GPS and signed installation still need to be performed on your devices. This repository contains source, not an already signed APK/IPA.

## 1. Configure services and start the API

Prerequisite: Node 24+. Run `npm ci`, then configure `.env` using `.env.example` without overwriting existing values. Follow **[docs/AUTH-SETUP.md](docs/AUTH-SETUP.md)** to supply real SMTP delivery credentials and Google OAuth client IDs. There is no verification-code bypass or pretend Google login.

```bash
npm run setup -- --name "Your school or college" --email "your-real-admin-email@school.edu" --kind college
npm run api
```

Save the generated administrator password privately. The operator creates the institution; ordinary users simply create an account in the app. The administrator must verify their real mailbox too. Data remains in `data/next-stop.db` and survives server restarts.

## 2. Open the app and create an account normally

In another terminal:

```bash
npm run start:go
```

For web: `npm run web`. For an installed development client: `npm run start:dev`.

There is no server-address screen. During Expo development, the app derives the API hostname from the Expo host and uses port 4000. Set `EXPO_PUBLIC_API_URL` for a separate API/tunnel or installed production build. Production needs your own real HTTPS endpoint. Supplying a URL is the development team's job, not a registration step for users.

The user flow is **Create account → Verify email → Choose a role → Join an institution**. Returning users choose Sign in. Forgot password sends an actual reset code. Google identity is verified on the backend; native Google sign-in requires a configured installed app, while email accounts work in Expo Go. Accounts persist on the API server, not in simulated phone state.

After sign-in, the institution administrator approves memberships, adds actual stops and assigns shuttles. Driver/student/parent realtime functionality is preserved. Parent visibility still requires an explicit student grant. Email verification does not grant institution access or driver approval.

## 3. Install on Android and iPhone

See **[docs/PHONE-INSTALL.md](docs/PHONE-INSTALL.md)** for both build paths, local-network setup, and the two-phone GPS test.

The `local-network` build profile bundles the JavaScript and produces an internally installable app that permits local HTTP. It does **not** require the Expo development server to stay running; only `npm run api` must stay running. Production builds require HTTPS. Android Maps SDK configuration and iOS signing are still required for the corresponding native builds.

Expo Go can help inspect UI, but it is not the driver-background-tracking test target. Use an installed native build for that test.

## What “real time locally” means here

Driver GPS → your computer's server → authenticated WebSocket event → authorized rider/parent app fetches the current state.

- No fabricated movement or timestamps. No location appears before the driver sends a real fix.
- An accuracy threshold and sample timestamps prevent low-quality or old samples being presented as current.
- The driver task requests updates around every 3 seconds on Android; actual timing is controlled by the OS/GPS. iOS location delivery also follows OS scheduling.
- WebSockets trigger immediate refreshes. Reconnection uses backoff, and a 10-second recovery refresh runs while the app is open.
- Background driver tracking is implemented using Expo TaskManager and Location, with Android foreground-service notification and iOS location indicator. It is configured and bundles successfully, but locked-screen behavior has not been physically tested here.
- Missing/old GPS is shown as offline/stale. Killing the app, revoking permission, losing Wi-Fi, or suspending the server can interrupt tracking. No “always works” guarantee is implied.
- Local transport messages do not require cloud hosting. Maps may require internet for their tiles. A phone outside the LAN cannot reach a private Wi-Fi server without a separate network path.

## Source layout

- `App.tsx` — session restoration and student/driver/parent/dispatch workspaces
- `src/features/auth/` — polished signup/sign-in, email codes, password recovery, Google UI and institution onboarding
- `src/app/` — Expo Router entry; registers the native background task
- `src/hooks/useLiveSnapshot.ts` — scoped snapshots, live events, recovery
- `src/services/` — server configuration, secure sessions, realtime client, GPS task
- `src/components/` — shared UI, original brand mark, native/web maps
- `server/` — HTTP + WebSocket server, SQLite, setup and authorization
- `tests/` — real HTTP/WS clients, access boundaries, persistence, native-config checks
- `docs/` — installation, architecture, API, brand guide, roadmap, validation record
- `AGENTS.md` — instructions for continued Codex development

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run export:web
npx expo export --platform ios --platform android --output-dir build/native
```

Exports validate JavaScript/native module bundling; they are not signed native builds or device acceptance tests. GitHub Actions runs lint, types, tests, and web export.

## Continue in GitHub and Codex

Create an empty GitHub repository, then run inside this folder:

```bash
git init
git add .
git commit -m "Initialize NEXT STOP live local app"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/next-stop.git
git push -u origin main
```

Or, with GitHub CLI already authenticated: `gh repo create next-stop --private --source=. --remote=origin --push`.

Suggested Codex task:

> Read AGENTS.md, README.md, docs/PHONE-INSTALL.md and docs/ROADMAP.md. Run the checks, then help me build and install NEXT STOP on Android and iPhone. Keep all transport data real. Preserve institution isolation, approved-driver assignment, and student-controlled sharing. Do not report device tests as passing until they actually run.

No remote GitHub repository, cloud server, store listing, or signed app binary has been created by this source delivery. Store release, push notifications, route optimization, ETA and fleet-scale infrastructure are unfinished. Password recovery is implemented; external mail/Google configuration and live-device verification remain required. Source licensing and brand availability remain your team's decisions.
