# Install NEXT STOP on Android and iPhone

## Hosted pilot build (recommended): works on any cellular or Wi-Fi network

Use this once the API is deployed to Azure (DEPLOY-AZURE.md). Phones talk to `https://<host>` directly; no laptop, shared Wi-Fi or Expo server is involved. Then run ACCEPTANCE.md.

1. Choose permanent app identifiers first. `com.nextstop.app` in `app.config.ts` is a placeholder; replace it with one your team controls (for example `edu.yourschool.nextstop` or `com.yourcompany.nextstop`). Android package names cannot change after a Play Store release, and Google sign-in and Maps keys are tied to it.
2. Set `EXPO_PUBLIC_API_URL` in the EAS `preview` environment (DEPLOY-AZURE.md step 8). The build fails on purpose if it is missing or not HTTPS.
3. Maps need no key: the app uses MapLibre with free OpenFreeMap tiles on both platforms.
4. Build and install:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                      # links an Expo project; set EAS_PROJECT_ID as it instructs
npx eas-cli@latest build --profile preview --platform android   # APK: open the link on the phone
npx eas-cli@latest device:create             # iPhone: register each test device first
npx eas-cli@latest build --profile preview --platform ios       # needs a paid Apple Developer account
```

These builds bundle the JavaScript, connect only over HTTPS, and include background-location support. This is still an internal test build, not a store release.

---

# Local-network testing (optional, development only)

## Before building either platform

1. Install dependencies with `npm ci` using Node 24+; configure real SMTP and Google IDs using AUTH-SETUP.md.
2. Create your institution with `npm run setup` (see README), then run `npm run api`.
3. Connect the computer and both phones to the **same trusted Wi-Fi**. A private router/hotspot is often easier than university Wi-Fi, which may isolate devices.
4. In a phone browser, open the printed LAN address plus `/health`, for example `http://192.168.1.20:4000/health`. It should return `service: next-stop`. If not, resolve the firewall, IP, or Wi-Fi isolation before troubleshooting GPS.
5. Replace `com.nextstop.app` in `app.config.ts` with your team's own bundle/package identifiers before registering signing and map credentials.

A public app-store release is not needed to test internally installed builds. Native builds need SDK/signing setup, and iOS installation needs an Apple-authorized signing path. This workspace has not produced a signed binary or accessed your signing accounts.

## Android: internal APK


Using Expo's build service:

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile local-network --platform android
```

Complete project/signing prompts with your team's account. Because app.config.ts is dynamic, if EAS asks you to add a project ID manually, set EAS_PROJECT_ID to the exact ID it returns in your .env and matching Expo build environment, then rerun the build. The profile produces an APK. Open the resulting build link on the Android phone and install it. Internal installation may require allowing that installer source. Supply EXPO_PUBLIC_API_URL in the build environment before creating this installed build; users then sign in normally without a server field.

If Android Studio, a supported JDK, and the Android SDK are already configured on your computer, you can instead build/run directly with a USB-connected device:

macOS/Linux:

```bash
ALLOW_LOCAL_HTTP=1 npx expo run:android --device
```

PowerShell:

```powershell
$env:ALLOW_LOCAL_HTTP = '1'
npx expo run:android --device
```

That direct debug build uses Metro; keep `npm start` running as directed. The internally distributed `local-network` APK bundles the app and only needs the API computer running.

For driver tracking, grant precise location, then **Allow all the time** when requested or in Android Settings. Keep the tracking notification enabled. Disable battery restrictions for this supervised test if the device stops the service. A killed/force-stopped app may stop sending location; the rider must see stale GPS rather than invented movement.

## iPhone: internally signed build

Use your team's Apple signing setup. EAS internal distribution commonly uses registered devices and ad hoc provisioning associated with an Apple Developer membership. Follow EAS prompts for your account and device rather than sharing signing credentials in chat.

```bash
npx eas-cli@latest login
npx eas-cli@latest device:create
npx eas-cli@latest build:configure
npx eas-cli@latest build --profile local-network --platform ios
```

Register both test iPhones before building if both will use iOS. Install using the build's internal distribution link on the registered phone. Follow iOS trust/developer-mode prompts if applicable to the chosen signing path.

On a Mac with Xcode and an available signing team, a direct device run is another option:

```bash
ALLOW_LOCAL_HTTP=1 npx expo run:ios --device
```

This direct development route may require Metro and Xcode signing configuration. It is distinct from the internally distributed build that bundles JavaScript.

Allow **Local Network**, **Precise Location**, and the requested background/Always location access for the driver. If iOS initially gives only When In Use, review Location Services settings and retry. Do not force-quit the app during the background test. Locked-screen delivery, indicators, Wi-Fi behavior, and battery impact must be validated on actual iPhones.

## Both phones: real journey acceptance test

Set the actual API origin in EXPO_PUBLIC_API_URL before building each installed app. Sign in normally; there is no user-entered server address. Registration verifies a real email before joining an institution.

Use the driver account on phone A and a student account on phone B. Have the administrator approve both and create actual stops and the assigned shuttle first. Do not operate app controls while driving; use a parked vehicle or a passenger tester.

1. Driver starts service and taps Start driver GPS tracking. Grant permissions.
2. Wait outdoors for a GPS fix. Student should see GPS LIVE, a timestamp, and the shuttle's actual position.
3. Walk a short safe route with the driver phone. Verify the marker follows actual coordinates on the other phone. Log observed lag; the app does not guarantee a fixed delivery interval.
4. Student requests pickup. Driver receives the request without a manual page reload, accepts, and records boarding/drop-off.
5. Lock phone A for several minutes while moving safely. Phone B should continue receiving updates. If not, record phone model, OS version, permissions, battery settings, GPS age, and driver status.
6. Disconnect driver Wi-Fi. GPS should become stale after about 30 seconds, with no fabricated movement. Restore Wi-Fi and verify a new fresh fix replaces it.
7. Stop/restart the API server. Apps should reconnect and reread persisted state. A live channel alone does not mean GPS is fresh; check both indicators.
8. Grant parent visibility from the student account. Parent sees only that student's journey. Revoke and confirm future access disappears on the parent's connected screen.
9. Complete/cancel outstanding pickups, then end service. Driver tracking should stop. Sign-out also stops GPS.

## Local HTTP versus production

`local-network` sets `ALLOW_LOCAL_HTTP=1`. Android cleartext transport and an iOS ATS exception are enabled for this internal profile; runtime configuration restricts HTTP to private/local hosts. Local HTTP does not encrypt credentials or locations, so use trusted test Wi-Fi and non-sensitive test accounts. It is not the production release configuration.

The production profile sets `ALLOW_LOCAL_HTTP=0`; HTTPS is required. Switching the app to a different server clears its local token and stops driver tracking before sending credentials to the new endpoint. Never expose the local HTTP API directly to the public internet.

## Troubleshooting

| Symptom                                     | Check                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Phone cannot open `/health`                 | Same LAN, correct computer IP, server bound to 0.0.0.0, firewall TCP 4000, no AP/client isolation                 |
| `/health` opens but app refuses HTTP        | Install the `local-network` build; production build deliberately requires HTTPS                                   |
| Map is blank                                | Internet access for map tiles (openfreemap.org); the GPS status and timestamp still work without the map      |
| Driver has no assigned shuttle              | Administrator approves the driver and creates a shuttle assigned to that driver                                   |
| GPS remains offline                         | Active service, native build rather than Expo Go, precise + background permissions, outdoor fix                   |
| GPS stops on lock                           | Always/all-time permission, background modes, Android foreground service/battery settings; record device evidence |
| Web UI cannot access server                 | Exact browser origin must appear in `ALLOWED_ORIGINS`; native clients do not use browser CORS                     |
| Browser cannot share location over LAN HTTP | Browser geolocation requires a secure context; use the installed app or HTTPS, not LAN HTTP browser GPS           |
| Driver leaves Wi-Fi range                   | A private LAN server is no longer reachable. Use a secure reachable server/network for off-campus trips           |

An installed app can operate against a local server. A single isolated phone cannot deliver realtime updates to another phone without a shared network/server path.
