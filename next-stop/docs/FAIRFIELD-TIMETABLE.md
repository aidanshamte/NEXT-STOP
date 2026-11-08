# Fairfield University timetable: what is published and what is missing

Checked 2026-11-08. **Nothing has been imported.** The only current source has no effective dates, and the app requires dates for every service period. Without them it could show past or future terms as today's service.

## Source

fairfield.edu, Transportation and Parking (`/student-life/campus-services/transportation-and-parking`, also served at `/parking`), read 2026-11-08. The page carries no publication or effective date, and the schedule PDFs it once linked are gone. The 2023 parking-map brochure link returns 404. Live tracking is through the TripShot app, whose data is not public.

Time zone: Fairfield, Connecticut is in `America/New_York`. It is not set yet: under **Setup → Institution settings** the field is prefilled from the administrator's device, so one tap on **Save settings** sets it.

## What the page states (verbatim facts)

| Service                | Published                                                                                                                                                                                                                                                                                                                               | Exact enough to import?                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Campus Shuttle         | Mon–Thu 7:30 a.m.–8:30 p.m.; Fri 7:30 a.m.–3:30 p.m.; Sat–Sun 9 a.m.–3:30 p.m. "Generally runs every 30 minutes." Mon–Fri 11 a.m.–3:30 p.m. runs hourly, leaving Barone Campus Center at :30.                                                                                                                                           | Hours and the 11–3:30 exception, yes. "Generally every 30 minutes" gives no departure times. |
| 1720 Post Road Shuttle | Mon–Fri, leaves Barone Campus Center for 1720 Post Road at 10:45, 11:45, 12:45 and 1:45.                                                                                                                                                                                                                                                | Yes: four exact departures.                                                                  |
| Town Shuttle           | Mon–Fri 7 a.m.–9:50 p.m.; Sat–Sun 12 p.m.–9:50 p.m.; leaves Barone Campus Center "approximately once every hour". The final 9:50 p.m. run stops at the Dolan School of Business, then gives on-demand drop-offs at the Fairfield Train Station overpass, Grasmere Avenue and Post Road, and the Metro Train Station (Alto garage side). | No: "approximately"; see the conflict below.                                                 |
| Bellarmine Shuttle     | Mon, Tue, Thu, Fri 8 a.m.–5 p.m.; no service Wed, Sat or Sun. The 5 p.m. trip is drop-off only, at Bridgeport Train Station and Barone Campus Center.                                                                                                                                                                                   | Hours only; no departure times.                                                              |
| All                    | Operates during the academic year only. No service on Columbus Day weekend, Thanksgiving weekend, Christmas semester recess, Martin Luther King Jr. Day, Easter recess or spring break. "The schedule is subject to change."                                                                                                            | Closure names only; no dates.                                                                |

**Conflict on the same page:** the introduction says the Town shuttle runs "on the hour beginning at noon Saturday and Sunday until 7 p.m.", but the Town Shuttle section says weekends run 12 p.m. to 9:50 p.m.

## Missing before anything can be imported

1. **Effective dates:** the first and last service day of the current term (Fall 2026), confirming that this page is the current timetable.
2. **Closure dates** for this academic year: Columbus Day weekend, Thanksgiving weekend, Christmas recess, MLK Day, Easter recess and spring break. These come from Fairfield's academic calendar; the shuttle office should confirm they match.
3. **Campus Shuttle departure times** outside 11 a.m.–3:30 p.m. Is it exactly :00 and :30 from 7:30 a.m.?
4. **Town Shuttle departure times:** exact minutes past the hour, and which of the two weekend end times is correct (7 p.m. or 9:50 p.m.).
5. **Bellarmine Shuttle departure times** from Barone Campus Center and from Bellarmine.
6. **Stop-by-stop times** (minutes after leaving Barone) for every route. None are published; without them the app shows only departures from the first stop.
7. Whether the **1720 Post Road** times also apply in the current term.

When this is available, an administrator enters it under **Schedules → Publish a timetable**:

1. A service period with the dates and days.
2. Its departures.
3. Stop offsets.
4. Closures.

The app labels it "Scheduled", separate from live GPS. Or send it to the team, who will add it to an import file with the source and dates recorded.
