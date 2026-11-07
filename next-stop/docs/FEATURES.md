# Stitch feature checklist

Compares every capability shown in the seven Stitch references (`design/stitch/`) with the code. The references are design material: their names, routes, times, seat counts, prices, police positions and safety claims are fictional and are never shown as facts.

Status: **Done** (in the code, with the named evidence), **Partial**, **Missing**, **Blocked** (needs an outside account, agreement or data; the app side is built where possible), **Excluded** (deliberately not built). Baseline audit 2026-11-07 at `cc8dac2`; updated the same day after stages 1–3.

Evidence codes: **T** automated tests (file named), **B** local browser run through the real web UI against a throwaway database (VALIDATION 2e), **P** production web after deploy (VALIDATION 2e). No item is verified on a physical phone yet.

## Stage 1: pickup demand, capacity, favorites, stop details, schedules, notifications

| #    | Capability (reference)                                              | Baseline | Now     | Evidence                                                                                             |
| ---- | ------------------------------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| 1.1  | Live shuttle position with freshness (06, 01)                       | Done     | Done    | T `ui-state`; earlier VALIDATION 2d                                                                  |
| 1.2  | Stop strip in route order; stops open their details (06)            | Done     | Done    | B                                                                                                    |
| 1.3  | "I'm waiting here" on the existing pickup lifecycle (06)            | Partial  | Done    | B: "I’m waiting at Test Stop A" creates the request                                                  |
| 1.4  | Waiting count per stop, aggregate only (06)                         | Missing  | Done    | T `service`; B: second rider shown live, no reload                                                   |
| 1.5  | Waiting auto-clears; no-show and cancel reasons (06)                | Missing  | Done    | T `service`; B: expiry notice appeared live after 43 s                                               |
| 1.6  | Seats in use vs. real capacity, labelled as an estimate (06, 01)    | Partial  | Done    | T `service`, `client-logic`; B                                                                       |
| 1.7  | Driver correction of the onboard count                              | Missing  | Done    | T `service`; B                                                                                       |
| 1.8  | Admin-set capacity and vehicle features (06)                        | Missing  | Done    | T `service`; B                                                                                       |
| 1.9  | Stop details: description, routes, scheduled and live times (01)    | Missing  | Done    | B                                                                                                    |
| 1.10 | Directions (opens maps app) and share stop location (01)            | Missing  | Done    | B (buttons present; external apps not opened in headless browser)                                    |
| 1.11 | Amenities and accessibility, admin-verified with name and date (01) | Missing  | Done    | T `service`; B                                                                                       |
| 1.12 | Stop photos, admin-uploaded, type- and size-checked (01)            | Missing  | Done    | T `service`; B (upload via API; picker needs a device)                                               |
| 1.13 | Favorite stops and routes; saved places as labelled stops (02)      | Missing  | Done    | T `service`; B                                                                                       |
| 1.14 | Notification preferences (02)                                       | Missing  | Done    | T `service`, `eta`; B                                                                                |
| 1.15 | Dispatch alerts per route or institution (04, 06)                   | Partial  | Done    | T `service`; B                                                                                       |
| 1.16 | Delay alert push to affected riders and parents                     | Done     | Done    | T `push`, `service` (respects preferences)                                                           |
| 1.17 | Service periods, days, closures and notes (04)                      | Missing  | Done    | T `service` (DST cases); B                                                                           |
| 1.18 | Departures per route and scheduled time per stop (04)               | Missing  | Done    | T `service`; B                                                                                       |
| 1.19 | Day selector and route filter (04)                                  | Missing  | Done    | B                                                                                                    |
| 1.20 | Scheduled vs. live clearly distinguished (04, 01)                   | Missing  | Done    | B: "Scheduled" and "Live" labels                                                                     |
| 1.21 | Per-institution time zone and settings                              | Missing  | Done    | T `service`                                                                                          |
| 1.22 | Completed ride count on profile (02)                                | Missing  | Done    | B                                                                                                    |
| —    | Fairfield's real timetable, stop details, photos                    | —        | Blocked | Needs the institution's published schedule and an admin to enter and verify it; nothing was invented |

## Stage 2: arrival estimates

| #   | Capability                                                            | Baseline | Now     | Evidence                                                                                                    |
| --- | --------------------------------------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| 2.1 | "Last passed" stop from GPS crossing confirmed pins (06)              | Missing  | Done    | T `eta`; B                                                                                                  |
| 2.2 | Stop-to-stop travel-time history, no GPS tracks, 60-day retention     | Missing  | Done    | T `eta`                                                                                                     |
| 2.3 | Estimate as a range with sample count; "unavailable" with reason      | Missing  | Done    | T `eta`, `client-logic`; B: "Live estimate: 4–5 min"                                                        |
| 2.4 | Stop-approach notification 1–3 stops before the rider's stop (02, 06) | Missing  | Done    | T `eta` (through the GPS endpoint, sent once, respects "off")                                               |
| —   | Accuracy on real Fairfield service                                    | —        | Blocked | Needs confirmed stop pins, routes assigned to shuttles and days of real service before any estimate appears |

## Stage 3: passes, safety, sharing, shared rides, integrations

All stage 3 features are off for every institution until its administrator turns them on.

| #    | Capability                                                                       | Baseline | Now     | Evidence                                                                                               |
| ---- | -------------------------------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 3.1  | Rider pass: QR code changing every 30 s, first name only (02)                    | Missing  | Done    | T `safety`; B                                                                                          |
| 3.2  | Driver validates (camera on phones, typed code everywhere) and confirms boarding | Missing  | Done    | T `safety`; B (typed code). Camera scanning needs a phone test                                         |
| 3.3  | NFC tap and Apple/Google Wallet passes (02, 05)                                  | Missing  | Blocked | Apple Pass Type ID certificate; Google Wallet issuer account; NFC pass entitlement and vehicle readers |
| 3.4  | Parent journey sharing by student consent, immediate revocation (03)             | Done     | Done    | T `api`, `safety`                                                                                      |
| 3.5  | Share for one ride or a set time (03 "auto-expire on arrival")                   | Missing  | Done    | T `safety`; B                                                                                          |
| 3.6  | Parent sees who shares and on what terms; either side can end it                 | Partial  | Done    | T `safety`; B                                                                                          |
| 3.7  | Institution safety contacts and emergency number, tap to call or text (02, 07)   | Missing  | Done    | T `safety`; B                                                                                          |
| 3.8  | Incident report; status changes only when staff act                              | Missing  | Done    | T `safety`; B                                                                                          |
| 3.9  | Escort requests where the institution turns them on (07, 01)                     | Missing  | Done    | T `safety`; B                                                                                          |
| 3.10 | Opt-in shared-ride coordination: first names only, report and block (06)         | Missing  | Done    | T `safety`; B                                                                                          |
| 3.11 | Institution SSO (05 "Okta SSO")                                                  | Missing  | Blocked | Needs the institution's identity provider registration; not built in this pass                         |
| 3.12 | Payments / rideshare provider (02, 06)                                           | Missing  | Blocked | No fares exist; needs a fare policy and provider account                                               |

## Excluded

| Reference element                                                           | Reason                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| SOS that "dispatches" police, "DPS 911 LIVE", "Dispatched & Armed" (07)     | No authorized emergency integration. Reports and escorts are in-app only and say so.            |
| Police patrol positions and officer ETA (03, 07)                            | No such data source.                                                                            |
| Silent decibel telemetry / audio feed (03, 07)                              | Ambient microphone monitoring is out of scope; camera and picker plugins request no microphone. |
| Continuous rider location beacon to contacts and police (03)                | No mandatory or covert location sharing; rider location is not collected.                       |
| Siren and strobe (07)                                                       | Not a transit feature.                                                                          |
| "Time saved", "4,280 active riders", relief shuttle dispatched (02, 05, 06) | No valid data basis.                                                                            |
| Driver name and vehicle speed on the rider screen (06)                      | Not needed for boarding; minimizes driver data.                                                 |
| Crowd-sourced capacity check-ins (02)                                       | Replaced by driver-confirmed counts.                                                            |
| Rideshare price estimates and savings (06)                                  | No provider integration; prices would be invented.                                              |
| CCTV/patrol/FERPA/encryption claims (01, 03)                                | Not verifiable by NEXT STOP.                                                                    |
| PDF timetable and iCal feed (04)                                            | Deferred; not part of the 13 requested areas.                                                   |
| Dark mode, walking speed (02)                                               | Deferred.                                                                                       |
