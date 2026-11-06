# Architecture

The Expo app connects to a Node 24 HTTP/WebSocket server with SQLite persistence. There is no demo runtime, simulated vehicle source, or automatic institution/route seed. The setup CLI creates a real institution and initial administrator; approved administrators configure actual stops and assign shuttles through Dispatch.

## Accounts and institution boundaries

Ordinary signup creates a global persistent account, delivers a real email code and issues a session only after verification. Role/institution membership is a separate approved request after sign-in. Server-side SMTP handles verification/reset emails; Google identity uses validated signed ID tokens and an explicit linking policy. See AUTH-SETUP.md for credentials, single-use code controls and provider limits.

Normal users never configure a server. Expo development derives the API origin automatically, while installed apps use EXPO_PUBLIC_API_URL. SecureStore stores native tokens with their API origin; old tokens are cleared if the configured origin changes. Production uses HTTPS, with private-LAN HTTP permitted only in supported development/internal contexts. There is no fake default backend URL.

Every protected transport endpoint authenticates the token, verified email and institution membership/role. Driver approval and assignment remain separate. Parents still require a current student grant; email verification and Google login grant no transport privilege by themselves. Snapshot scope changes hide previous identities/institutions immediately.

## Real-time flow

Native driver location task → authenticated `/trips/location` → persisted sample → institution-scoped WebSocket invalidation → each authorized app rereads `/snapshot`.

The WebSocket authenticates with the first frame, never a token in the URL. It sends only `ready`/`invalidate`; no names, coordinates, request IDs, or student payloads. Snapshot authorization remains the source of truth. Heartbeats validate sessions and connection health. The client reconnects with exponential backoff, refreshes on ready/resume, coalesces overlapping refreshes, and uses a 10-second recovery fetch while open. Tenant switches hide the previous tenant's snapshot before any new data arrives.

Writes to requests, trip position/service/incident, shares, membership approval, stop creation, and shuttle assignment trigger live invalidation. This is server-driven update delivery rather than a timer animating a marker. There is still no guaranteed zero-latency network/OS delivery.

## Native tracking

`src/services/backgroundLocation.ts` registers a module-scope TaskManager callback before routes mount. Approved drivers explicitly start tracking on an active assigned trip. Native Location requests foreground/background permissions and runs with an Android foreground-service notification or iOS background-location indicator. Tracking context and session credentials are available to the native task through SecureStore after first unlock, scoped to the device.

The task publishes only the newest fresh accurate sample. Server validates coordinates, timestamp age/order, service state, assignment, and accuracy ≤100m. The UI marks location stale after 30 seconds; no GPS sample means offline. Old positions are not replayed as current. Background callback errors/network gaps produce status messages rather than fabricated coordinates. The next actual fix retries connectivity; there is no durable route-history queue.

Stopping tracking, switching institution/vehicle/server, ending service successfully, or signing out stops the native task. App backgrounding alone does not stop it. Force-quit, OS restrictions, permission loss, Wi-Fi loss, or a suspended computer can stop updates. Physical-device locked-screen behavior remains unverified in this workspace.

Browser GPS is an explicit foreground-only path and requires a secure context; plain LAN HTTP browser geolocation may be blocked. It is not presented as background mobile tracking.

## Journey state

`requested → accepted → boarded → arrived`

Requested/accepted pickups may be cancelled by the owner or assigned driver/admin. Students cannot confirm their own boarding/drop-off. Accepted and boarded requests reserve capacity. Service cannot end with open requests/onboard riders. A driver-confirmed arrival is not verified guardian handover.

The current stops are institution-wide: all assigned shuttles use that institution's configured stop set. Separate route definitions, stop ordering policies per trip, optimized skipping, and route-aware ETAs are unfinished.

## Sharing

Students grant/revoke parent email access only to approved parent memberships in their institution. Parent snapshots include only linked students' journeys, and vehicle visibility only for accepted/onboard trips. Revocation triggers live refresh and is immediately enforced by future API reads. Offline screens may retain their last in-memory data marked disconnected; previously viewed information cannot be recalled.

Verified child guardianship, school-managed child accounts, and handover workflows need separate implementation before school-age deployment. Current sharing models an adult student's choice.

## Hosted pilot (Azure)

```
phone app ──HTTPS / WSS──▶ Caddy :443 (TLS, Let's Encrypt) ──▶ Node API 127.0.0.1:4000 ──▶ SQLite on data disk
                                                              └─ daily verified backup ──▶ Blob storage (35 days)
```

- **One process, one instance.** Realtime subscriptions and rate limits are in memory, and all writes are serialized in one Node process, so pickup and capacity changes cannot race. Running a second instance would split realtime delivery; do not scale out without the shared event channel in ROADMAP.md.
- **Durability:** the database is on a separate managed disk that survives VM rebuilds and deploys. Schema changes are versioned migrations (`PRAGMA user_version`). Each deploy takes a verified backup first.
- **Secrets:** `/etc/next-stop/next-stop.env` on the VM only (root:nextstop 640). Storage access uses the VM's managed identity; no storage keys exist (shared-key access is disabled).
- **Logs:** JSON lines to journald with method, path, status and duration only.
- **Deploy:** release packages carry the server and its deploy config. The release script switches a symlink and waits for `/health` to report the new release id; otherwise it rolls back (DEPLOY-AZURE.md).

## Local development

Local service needs phones and the server computer on a reachable shared network, a firewall path to TCP 4000, and an awake computer. It is for development only; pilots use the hosted API.

Synchronous password hashing and in-process limits suit a pilot, not fleet scale. Remaining production work is tracked in ROADMAP.md (PostgreSQL path, audit logs, push notifications, load/security review).

## References

- Expo SDK 58 location: https://docs.expo.dev/versions/v58.0.0/sdk/location/
- Expo TaskManager: https://docs.expo.dev/versions/v58.0.0/sdk/task-manager/
- Expo build properties: https://docs.expo.dev/versions/v58.0.0/sdk/build-properties/
- MapLibre GL JS: https://maplibre.org/ · OpenFreeMap tiles: https://openfreemap.org/ (free, no key; attribution required and shown)
- Apple ATS exceptions: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads
