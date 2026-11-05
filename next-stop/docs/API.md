# API and realtime protocol

Default server: port 4000, bound to 0.0.0.0. JSON requests/responses. Protected endpoints require `Authorization: Bearer <token>` and institution scoping where shown. Errors return `{ "error": "message" }`. Sessions expire after seven days; logout invalidates the token. New registrations require administrator approval.

| Method | Path               | Body / query                                          | Permission                                                |
| ------ | ------------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/health`          | —                                                     | Public; `{ok:true,service:"next-stop",protocol:2}`        |
| GET    | `/institutions`    | —                                                     | Public names/IDs/kinds                                    |
| POST   | `/auth/register`   | name, email, password, role, institutionId            | Creates pending student/driver/parent membership          |
| POST   | `/auth/login`      | email, password                                       | Returns token                                             |
| POST   | `/auth/logout`     | `{}`                                                  | Current session                                           |
| GET    | `/me`              | —                                                     | Current user's profile and institution memberships        |
| GET    | `/snapshot`        | `?institutionId=...`                                  | Role-scoped current data                                  |
| POST   | `/stops`           | institutionId, name, lat, lng                         | Institution administrator                                 |
| POST   | `/trips`           | institutionId, name, driverId, capacity               | Administrator; approved same-institution driver           |
| POST   | `/requests`        | institutionId, tripId, stopId, destinationId          | Approved student                                          |
| POST   | `/requests/status` | institutionId, requestId, status                      | Owner cancellation or assigned driver/admin lifecycle     |
| POST   | `/trips/service`   | institutionId, tripId, active (boolean)               | Assigned driver/admin                                     |
| POST   | `/trips/location`  | institutionId, tripId, lat, lng, accuracy, capturedAt | Assigned driver/admin; active service; timestamp epoch ms |
| POST   | `/trips/issue`     | institutionId, tripId, delayMinutes (0–240), issue    | Assigned driver/admin                                     |
| POST   | `/shares`          | institutionId, email, revoke (optional boolean)       | Student-owned grant to approved parent                    |
| POST   | `/members/approve` | institutionId, userId                                 | Institution administrator                                 |

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
- `DATABASE_PATH`: `./data/next-stop.db` relative to command working directory
- `ALLOWED_ORIGINS`: exact comma-separated browser origins; defaults http://localhost:8081 and http://localhost:19006
- `ALLOW_LOCAL_HTTP`: native build flag, 1 only for the local-network internal build; production profile forces 0
- `EXPO_PUBLIC_API_URL`: optional default origin; users can configure server address in the app
- `GOOGLE_MAPS_ANDROID_API_KEY`: build configuration for the Android map SDK

`npm run setup` is the trusted local operator bootstrap path. There is no public administrator-signup or institution-creation API.
