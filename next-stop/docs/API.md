# API and realtime protocol

Default server: port 4000, bound to 0.0.0.0. JSON requests/responses. Protected endpoints require `Authorization: Bearer <token>` and institution scoping where shown. Errors return `{ "error": "message" }`. Sessions expire after seven days; logout invalidates the token; expired sessions and codes are pruned hourly. Accounts require email or Google verification; institution memberships are requested separately and require administrator approval.

| Method | Path               | Body / query                                          | Permission                                                                                                                                        |
| ------ | ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`          | —                                                     | Public; `{ok,service,protocol:3,schema,uptimeSeconds}`; 503 if the database is unavailable                                                        |
| GET    | `/institutions`    | —                                                     | Public names/IDs/kinds                                                                                                                            |
| POST   | `/auth/register`   | name, email, password                                 | Creates unverified global account and sends real email code                                                                                       |
| POST   | `/auth/login`      | email, password                                       | Returns token                                                                                                                                     |
| POST   | `/auth/logout`     | `{}`                                                  | Current session                                                                                                                                   |
| GET    | `/me`              | —                                                     | Current user's profile and institution memberships                                                                                                |
| GET    | `/snapshot`        | `?institutionId=...`                                  | Role-scoped current data                                                                                                                          |
| POST   | `/stops`           | institutionId, name, lat, lng                         | Institution administrator                                                                                                                         |
| POST   | `/trips`           | institutionId, name, driverId, capacity, vehicleType  | Administrator; approved same-institution driver. vehicleType optional: `bus`, `shuttle` or blank (not set)                                        |
| POST   | `/requests`        | institutionId, tripId, stopId, destinationId          | Approved student                                                                                                                                  |
| POST   | `/requests/status` | institutionId, requestId, status                      | Owner cancellation or assigned driver/admin lifecycle                                                                                             |
| POST   | `/trips/service`   | institutionId, tripId, active (boolean)               | Assigned driver/admin                                                                                                                             |
| POST   | `/trips/location`  | institutionId, tripId, lat, lng, accuracy, capturedAt | Assigned driver/admin; active service; timestamp epoch ms. Optional heading (0–359.9°) and speed (m/s): heading kept only if speed ≥ 1            |
| POST   | `/trips/issue`     | institutionId, tripId, delayMinutes (0–240), issue    | Assigned driver/admin                                                                                                                             |
| POST   | `/shares`          | institutionId, email, revoke (optional boolean)       | Student-owned grant to approved parent                                                                                                            |
| POST   | `/members/approve` | institutionId, userId                                 | Institution administrator                                                                                                                         |
| POST   | `/members/revoke`  | institutionId, userId                                 | Administrator (not self). Removes membership, cancels pending pickups, removes sharing, unassigns their vehicles                                  |
| POST   | `/trips/assign`    | institutionId, tripId, driverId                       | Administrator; approved same-institution driver (handover)                                                                                        |
| POST   | `/account/delete`  | password (or confirmEmail for Google-only accounts)   | Current user. Refused while on board, driving, or as an institution's last administrator. Deletes sessions, memberships, sharing and ride history |

Pending accounts receive an operationally empty snapshot. Parents cannot self-link, discover students, publish coordinates, or change trip state. Driver snapshots contain only assigned trips and their requests. Every referenced stop/trip/driver is checked against the institution on creation.

## WebSocket `/realtime`

Connect to the same origin using `ws:` for trusted local HTTP or `wss:` for HTTPS. Within five seconds send:

```json
{ "type": "subscribe", "token": "<session-token>", "institutionId": "<authorized-institution-id>" }
```

Server responds `{"type":"ready"}`. Successful institution mutations produce `{"type":"invalidate"}`. On invalidate, fetch a new authenticated snapshot. There is no sensitive trip payload on this channel. Sessions/memberships are validated at subscription, heartbeat, and publication; an unauthorized socket closes with code 4001. Malformed/repeated subscription closes with code 4000. Reconnect clients should reread state rather than assume every event was delivered.

The channel supports one institution per connection. Pending members can subscribe to receive approval-driven refreshes but still have no operational access until approved. Browser origins must be allowlisted; native sessions are token-authenticated.

## Configuration

- `PORT`: 4000 by default
- `HOST`: bind address; defaults to 127.0.0.1 when `NODE_ENV=production` (behind Caddy), otherwise 0.0.0.0
- `NODE_ENV=production`: JSON request logs to stdout, no LAN address hints, no default browser origins
- `TRUST_PROXY=1`: use the reverse proxy's `X-Forwarded-For` for per-client auth rate limits. Set only behind a proxy that overwrites the header (Caddy does)
- `AUTH_RATE_LIMIT`: auth attempts per client address per endpoint per minute (default 30). Authenticated calls are limited to 240/min per session
- `BACKUP_BLOB_CONTAINER_URL`: Azure Blob container for `node server/backup.mjs backup --upload` (managed identity; no keys)
- `DATABASE_PATH`: `./data/next-stop.db` relative to command working directory
- `ALLOWED_ORIGINS`: exact comma-separated browser origins; defaults http://localhost:8081 and http://localhost:19006
- `ALLOW_LOCAL_HTTP`: native build flag, 1 only for the local-network internal build; production profile forces 0
- `EXPO_PUBLIC_API_URL`: developer-configured backend origin for installed apps; Expo development may derive the API host automatically. There is no user server-entry screen.
- Maps use MapLibre with OpenFreeMap tiles; no map API key is needed.
- Map markers are inline SVG inside the shared map document (`src/components/mapHtml.ts`, served to the website as `public/map.html`), so they need no native module. Snapshot trips carry `vehicle_type` and `heading` (null unless the last fix reported a valid heading while moving; cleared when service ends). The viewer's own location for the blue dot is read on the device after they tap the map's location button and is passed only to the local map; it is never sent to the API.

`npm run setup` is the trusted local operator bootstrap path. There is no public administrator-signup or institution-creation API.

## Account verification and recovery

- `GET /auth/options`: public provider availability and Google web client identifier (not secrets).
- `POST /auth/verify`: email + six-digit code → session after one-time verification.
- `POST /auth/resend`: email → rate-limited verification delivery.
- `POST /auth/forgot`: email → non-enumerating reset request response.
- `POST /auth/reset`: email + reset code + new password → resets password and revokes existing sessions.
- `POST /auth/google/challenge`: returns five-minute web nonce.
- `POST /auth/google`: idToken + platform (web/native) + web challenge → validated Google identity and session or required email verification.
- `POST /auth/google/link`: same identity payload + existing verified-account bearer session → explicit Google link.
- `POST /memberships`: authenticated institutionId + student/parent/driver role → pending membership. Public clients cannot select administrator.

Registration, unverified-password login, and third-party-domain Google login may return `{requiresVerification:true,email}` instead of a token. `/me` works for verified accounts even before they join an institution. Email delivery errors return an error and never an OTP/token. Verification codes are never part of an API response.

Google needs provider client IDs; SMTP needs actual sender credentials. See AUTH-SETUP.md. Old clients using register-with-institution must upgrade to the protocol-3 onboarding flow.

## Rider services (stage 1)

All are institution-scoped (`institutionId` in the body or query) and require an approved membership. "Admin" means the institution's approved administrator.

- `POST /settings` (admin): `timezone` (IANA name), `requestExpiryMinutes` (5–240, default 30).
- `POST /prefs`: `tripUpdates`, `delayAlerts`, `serviceAlerts` (booleans), `approachStops` (0 = off, 1–3).
- `POST /favorites`: `kind` (`stop`|`route`), `targetId`, optional `label` (≤40). `POST /favorites/remove`. Confirmed stops and own-institution routes only; 50 per person.
- `POST /alerts` (admin): `severity` (`info`|`delay`|`interruption`), `title`, `body`, optional `routeId`, `startsAt`, `endsAt`. Delays and interruptions that apply now are pushed to followers of the route and riders on it (or all students and parents for institution-wide alerts) who have service alerts on. `POST /alerts/resolve`.
- `POST /stops/details` (admin): `stopId`, `name`, `description` (≤500), `accessibility` (≤300), `amenities` (`[{key, detail}]` from `server/catalog.json`). Clears verification. `POST /stops/verify` (admin, confirmed stops only).
- `POST /stops/photo` (admin): `stopId`, `contentType` (JPEG/PNG/WebP, checked against the bytes), base64 `data` ≤900 KB (160–4096 px per side), optional `thumbData`/`thumbType` ≤120 KB (≤800 px), and optional `alt`, `shows` (`boarding`|`landmark`), `source` (`own`|`institution`|`licensed`), `credit`, `license`, `sourceUrl`, `licenseUrl` (https). Metadata (EXIF/GPS, XMP, IPTC, comments, text chunks) is removed before storage. Replacing a photo clears its verification.
- `POST /stops/photo/details` (admin): the same descriptive fields; clears verification. `POST /stops/photo/verify` (admin): `stopId`, `version` (the photo version the admin saw; 409 if it changed). Needs a confirmed stop, alt text of 10+ characters, the source, and for licensed photos the credit, licence and link. `POST /stops/photo/suggested` (admin): applies the researched photo shipped for that stop (unverified). `POST /stops/photo/delete`.
- `GET /stops/photo?stopId=&size=thumb|full` returns `{contentType,data,updatedAt,size}`. Riders: verified photos of confirmed stops only. Admins: any.
- `GET /stops/walk?stopId=&lat=&lng=`: walking route from the given position to the stop's confirmed boarding point (never a client-supplied destination). The app sends the position already rounded to 4 decimals (about 10 m); the server rounds again, then sends that position and the boarding point to the OSRM foot service run by FOSSGIS e.V. at routing.openstreetmap.de. Neither is stored, logged or cached. Returns `{stopId,to,coords:[[lng,lat]…],distance,duration,startGap,endGap,provider,attribution,fixUrl}`. 404 for draft or other-institution stops, 422 when no route exists or the start is over 20 km away, 429 per-rider limits (3 s apart, 60 per hour), 503 when the provider fails, times out (8 s) or is busy. Provider calls are spaced at least 1.1 s apart across all riders (queued up to 2.5 s, then refused with 503), and a 429 from the provider pauses all calls for 60 s. GET, so it triggers no realtime refresh.
- `POST /trips/vehicle` (admin): `tripId`, `capacity` (1–100), `features` (from the catalog), optional `vehicleType` (`bus`, `shuttle`, or `''` for not set; omitted keeps the saved type). The map draws a bus or van silhouette only from this saved value.
  Also optional `accessRamp` and `accessSpace`: `available`, `unavailable` or `unknown` (default), as the administrator confirmed them on the vehicle. Never inferred from the type or icon. An older client ticking the "Wheelchair ramp"/"lift" feature records the ramp as available.

### Boarding assistance (on the pickup request)

No diagnosis is asked for. Visible only to the rider, the driver assigned to the request's shuttle now, and administrators; parents following a journey never receive it. Notifications say only "Pickup details updated" or "Staff attention needed". Notes (≤ 140 characters, only with "other") and staff messages are erased when the pickup is cancelled or completed.

- `POST /requests` accepts optional `assistance: { needs, note }`, where `needs` ⊆ `ramp`, `extra_time`, `other`. Saved in the same transaction as the request.
- `POST /requests/assistance` (the rider, before boarding): `requestId`, `baseVersion`, `assistance`. Empty `needs` removes it. Each change increments the version and requires a new acknowledgement. Resending the same content is a no-op (200, `changed: false`); a different change against an old version gets 409.
- `POST /requests/assistance/ack` and `/requests/assistance/unable` (only the driver assigned now): `requestId`, `version`. A stale version gets 409. "Unable" alerts administrators and tells the rider. Repeats are no-ops.
- `POST /requests/assistance/resolve` (admin): `requestId`, `version`, `message` (≤ 200, shown to the rider), `outcome` `resolved` or `driver_review` (asks the driver to acknowledge again).
- Staff attention is raised when the driver is unable, or when a ramp/lift request is on a vehicle whose recorded ramp/lift or wheelchair space is not `available` (`vehicle_unavailable` or `vehicle_unknown`). It is re-evaluated when an administrator changes that record.
- Reassigning or removing the shuttle's driver returns acknowledged or unable requests to pending for the new driver. Cancelling the pickup cancels the assistance (database trigger).
- Snapshot field `assistance`: open requests only. An acknowledgement is reported only if it was made by the driver assigned now, for the current version.
- `POST /trips/onboard` (assigned driver or admin, in service): `tripId`, `count` (0–200). Boarded +1 and arrived −1 adjust it automatically.
- `POST /requests/status` also accepts `reason: 'no_show'` for driver/admin cancellations; requests record `cancel_reason` (`rider`, `driver`, `no_show`, `expired`, `access_removed`). Unaccepted requests are cancelled after the expiry window, checked every minute.
- `GET /schedule?date=YYYY-MM-DD`: `{configured:false}` until a time zone is set; otherwise the day's periods, closures/notes (next 120 days), raw departures and, per route, departure instants (DST-aware). When the institution has a shipped published schedule (`server/imports/*-published-schedule.json`, read-only, matched by institution name and route import key), the response also has `published: {source:{name,url},checkedAt,timezone,calendar:{confirmed,note,closures},routes:[{route_id,noService,noServiceText,hours:[{start,end|null,endConflict?:{text,detail,options}}],rules:[{text,departures}]}]}` for that day, even with `configured:false` (then `timezone`/`date` come from the file). Published times are departure instants from the first stop only; `calendar.confirmed:false` means they are not confirmed for any date.
- `POST /schedule/period` (admin): `name`, `startDate`, `endDate`, `days` (7-character Mon–Sun mask), optional `periodId` to edit. `POST /schedule/period/delete`.
- `POST /schedule/departures` (admin): `routeId`, `periodId`, and `times` (`HH:MM` list) or `from`/`to`/`every` (3–240 min). Replaces that route-period's departures (≤300).
- `POST /schedule/offsets` (admin): `routeId`, `offsets: [{position, minutes|null}]`, non-decreasing along the route.
- `POST /schedule/exception` (admin): `date`, `kind` (`closed`|`note`), `note`, optional `routeId`. `POST /schedule/exception/delete`.

Snapshot additions: `settings`, `demand` (waiting counts per stop, no identities), `alerts`, `favorites`, `prefs`, `rideCount`, stop details (`amenities`, verification, `has_photo`, `photo` record: riders get verified photos only; admins also get `photo_suggestion`), `campus_photos` (`{name,url,source}`: a link to the institution's official campus-map page for the stop's landmark; no copied photos), admin-only `campus_map` (`{source,checkedAt,note,boardingPoint:false,records:[{locationId,name,kind,url,distance}]}`, from `server/imports/*-campus-map.json`; evidence only, never a boarding point; read-only), trip `onboard`/`reserved`/`features`, route-stop `offset_minutes`.

## Arrival estimates (stage 2)

Each accepted GPS fix is checked against the next stops on the trip's route (confirmed pins only, 40 m from the path between fixes). Passing a stop records the route position and the stop-to-stop travel time (`segment_times`: route, positions, seconds, time; no coordinates, no driver). Snapshot trips carry `progress` (`position`, `stop_id`, `at`), `estimates` (`[{stop_id, low, mid, high, samples}]`, seconds from `progress.at`, 20th/50th/80th percentiles of the last 50 samples per segment, at least 3) and `reason` when there are none (`no_route`, `no_progress`, `insufficient_history`, `overdue`). Clients hide estimates while GPS is more than 30 s old. Riders with a `requested`/`accepted` pickup are notified once when the shuttle passes a stop 1–3 stops before theirs (their `approachStops` choice).

**Accuracy (measured, not assumed).** At every passage the estimates then shown for the stops ahead are stored in `estimate_checks` (route positions, range, sample count, time; no coordinates or identities) and resolved when the same vehicle passes that stop. Unresolved checks end with service or after two hours. `GET /estimates/accuracy?institutionId=` (admin): `{days:30, checks, within, medianError, pending, routes:[{routeId,name,checks,within,medianError}]}`; "within" means the actual arrival fell inside the shown range ±60 s.

## Boarding points: pins and researched suggestions

`POST /stops/pin` (admin): `stopId`, `lat`, `lng`, optional `source` (`gps`, otherwise recorded as entered). Confirms the stop and records `pin_source`, `pinned_by` and `pinned_at`. Administrator snapshots include draft stops with `import_key` and, where `server/imports/*-stop-suggestions.json` has one for that institution (matched by institution name and import key), a `suggestion` (`lat`, `lng`, `confidence` high/medium/low, `basis`, `source`, `researchedAt`) or an `unresolved` reason. `POST /stops/approve-suggestion` (admin): `stopId`. Pins the stop with the file's coordinates (client coordinates are ignored); 409 for a stop already confirmed, 400 without a suggestion. Riders never receive suggestions or pin provenance.

## Passes, safety, sharing and shared rides (stage 3)

All off until the administrator turns them on with `POST /safety/settings` (`passesEnabled`, `incidentsEnabled`, `escortsEnabled`, `sharedRidesEnabled`, `emergencyNumber`, `escortNote`). `POST /safety/contacts` (admin): `label`, `phone`, `kind`, `hours`, `sms`, or `remove` + `contactId`.

- `POST /pass/issue` (student), `GET /pass/code` → `{qr, code, firstName, expiresAt}`; the six-digit part is an HMAC of a per-pass secret and the 30-second time step. `POST /pass/revoke` (self, or admin with `userId`). `POST /pass/validate` (driver in service, or admin): `code` (QR text or typed `ABCDE-123456`), accepts the current step ±1, locks a pass after 10 wrong codes in 10 minutes, audits every check in `pass_scans` (no codes stored) and returns `{valid, firstName, repeat, request}` or `{valid:false, reason}`.
- `POST /shares`: `email`, `mode` (`ongoing`, `hours` + `hours` 1–72, or `ride` for the current request only), or `revoke: true`. `POST /shares/stop-all` (student), `POST /shares/leave` (parent, `studentId`). Expired and finished one-ride shares stop applying immediately on reads and are deleted within a minute.
- `POST /incidents`: `category`, `description` (≤1000), optional `stopId`, `tripId`, and for `shared_ride` a `subjectId` in the reporter's current group. Admins are notified. `POST /incidents/update` (admin): `status` (`acknowledged`|`resolved`), `note`; the reporter is notified.
- `POST /escorts` (student): `stopId`, `destination`, `note`; one open request. `POST /escorts/update`: admin `accepted`/`declined`/`completed`/`cancelled` with `note`; the rider may cancel their own.
- `POST /rides/intent` (student): `fromStop`, `toStop`, `leaveAfter`, `leaveBefore` (≤3 h, within a day), `consent: true`; or `clear: true`. `POST /rides/coordinate` (`join`), `POST /rides/block` (`userId`). The snapshot `rides` shows a match count, and first names only of others in the same group.

## Data retention

The server stores only the latest shuttle position per vehicle, and only while service is active. Ending service clears it. There is no location history table. Stop-to-stop travel times and estimate checks (no coordinates or identities) are kept 60 days. Pass checks are kept 90 days, closed escort requests 90 days and resolved reports one year. Account deletion removes favorites, preferences, passes, escort requests, shared-ride entries and blocks, and removes the reporter's identity from reports kept by the institution. Request logs record method, path, status and duration only.
