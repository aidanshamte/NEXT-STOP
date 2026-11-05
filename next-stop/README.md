# NEXT STOP

**Your ride. In sight.**

A school and college shuttle app with actual accounts, institution permissions, pickup requests, driver GPS, parent-authorized trip sharing, and an authenticated live connection. **There is no demo mode or simulated vehicle feed.** A new database is empty until you create your institution and register people.

The server can run on your computer. Android and iPhone apps connect to it over the same Wi-Fi; a public cloud backend is not required for that local test. Physical-device GPS and signed installation still need to be performed on your devices. This repository contains source, not an already signed APK/IPA.

## 1. Create your institution and start the server

Install **Node.js 24+**, open a terminal in the project folder, then:

```bash
npm ci
npm run setup -- --name "Your school or college" --email "your-real-admin-email@school.edu" --kind college
npm run api
```

Use `--kind school` for a school. The setup command prints a generated administrator password: save it privately. It does not add invented stops, buses, students, or locations. To create another institution, run setup again with the new institution name. An existing administrator email keeps its existing password and gets a second institution membership.

The API prints the computer's LAN address, such as `http://192.168.1.20:4000`. Leave the server running and keep the computer awake. Data persists in `data/next-stop.db`. Do not delete that folder to “restart” the app; it contains your real accounts and trips.

If you used an earlier version's sample database, use a **new empty DATABASE_PATH** for this version instead of retaining fictional records. No data is silently deleted or migrated.

## 2. Configure actual service

You can do administration from a browser on the server computer while preparing phone builds:

```bash
npm run web
```

Enter `http://localhost:4000` in the app's server field and connect. Sign in using the administrator credentials printed by setup.

1. Have the driver and students create their own accounts in your institution. Parents can also register.
2. In Dispatch, verify identities and approve their pending memberships.
3. Add at least two **actual** stops using verified latitude/longitude. On a location-capable device, “Use my current GPS” captures the stop position.
4. Enter a shuttle name, passenger capacity, and approved driver; create the assigned shuttle.
5. The assigned driver starts service and enables GPS tracking. Students choose that shuttle and request pickup.
6. Driver accepts the request, confirms boarding, and confirms drop-off. Open rider screens update through the live connection.
7. A student can grant an approved parent's email trip visibility in Account and revoke it later. This shares journey status and the assigned vehicle after acceptance, not the student's phone location.

The current guardian flow is student-authorized sharing suitable for a college pilot. Verified guardianship, school-managed child accounts, and guardian handover are separate unfinished school-deployment requirements.

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

- `App.tsx` — real connection/auth flow and student/driver/parent/dispatch workspaces
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

No remote GitHub repository, cloud server, store listing, or signed app binary has been created by this source delivery. Store release, push notifications, route optimization, ETA, account recovery, and fleet-scale infrastructure are unfinished. Source licensing and brand availability remain your team's decisions.
