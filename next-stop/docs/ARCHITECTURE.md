# Architecture — real local service

The Expo app connects to a Node 24 HTTP/WebSocket server with SQLite persistence. There is no demo runtime, simulated vehicle source, or automatic institution/route seed. The setup CLI creates a real institution and initial administrator; approved administrators configure actual stops and assign shuttles through Dispatch.

## Connection and institution boundaries

The installed app saves a server origin and mobile session token in SecureStore. Server changes stop driver tracking and clear the previous token. Browser server configuration is saved in localStorage; browser tokens remain memory-only. Production builds use HTTPS; an explicit local-network build supports private/local HTTP addresses on trusted test networks.

Every protected endpoint authenticates the token and institution membership server-side. Approved students can create their own requests. Driver registration remains pending until verified by an administrator; even approved drivers can operate only their assigned trips. Parent visibility requires an explicit current student grant within the same institution. Multiple institution memberships are supported without a UI role override.

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

## Local versus production

Local service needs phones and the server computer on a reachable shared network, a firewall path to TCP 4000, and an awake computer. GPS and realtime messages do not need cloud hosting; map tiles can require internet. Wi-Fi client isolation can prevent connectivity. Outside the LAN, a secure reachable server/network is needed.

SQLite, synchronous password hashing, and a single-process rate limiter support this small deployment; they are not a fleet-scale architecture. Next production work includes managed PostgreSQL/migrations, audit and retention controls, account recovery/suspension, durable notification delivery, deployment ownership, monitoring, backups/restore testing, and load/security review.

## References

- Expo SDK 58 location: https://docs.expo.dev/versions/v58.0.0/sdk/location/
- Expo TaskManager: https://docs.expo.dev/versions/v58.0.0/sdk/task-manager/
- Expo build properties: https://docs.expo.dev/versions/v58.0.0/sdk/build-properties/
- React Native Maps: https://github.com/react-native-maps/react-native-maps
- Apple ATS exceptions: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowsarbitraryloads
