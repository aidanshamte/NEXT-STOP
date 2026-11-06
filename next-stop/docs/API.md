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
| POST   | `/trips`           | institutionId, name, driverId, capacity               | Administrator; approved same-institution driver                                                                                                   |
| POST   | `/requests`        | institutionId, tripId, stopId, destinationId          | Approved student                                                                                                                                  |
| POST   | `/requests/status` | institutionId, requestId, status                      | Owner cancellation or assigned driver/admin lifecycle                                                                                             |
| POST   | `/trips/service`   | institutionId, tripId, active (boolean)               | Assigned driver/admin                                                                                                                             |
| POST   | `/trips/location`  | institutionId, tripId, lat, lng, accuracy, capturedAt | Assigned driver/admin; active service; timestamp epoch ms                                                                                         |
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
- `GOOGLE_MAPS_ANDROID_API_KEY`: build configuration for the Android map SDK

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

## Data retention

The server stores only the latest shuttle position per vehicle, and only while service is active. Ending service clears it. There is no location history table. Request logs record method, path, status and duration only.
