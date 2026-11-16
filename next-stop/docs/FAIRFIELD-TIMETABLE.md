# Fairfield University timetable: what is published and what is imported

Checked 2026-11-16 (first read 2026-11-08; unchanged). The published hours, frequency wording, explicit departures and notes are imported as a **published schedule** (`server/imports/fairfield-university-published-schedule.json`). They appear under **Schedules** and on each stop's **Scheduled today** card, labelled "Published schedule · Not live", separate from live shuttle positions and from any timetable an administrator enters.

## Source

fairfield.edu, Transportation and Parking: https://www.fairfield.edu/student-life/campus-services/transportation-and-parking/ (the Campus, Town and Bellarmine Shuttle sections are collapsed on the page). The page carries no publication, effective or term date. Live tracking is through the TripShot app, whose data is not public.

Time zone: `America/New_York`, recorded in the file and used to turn the published local times into times for the day shown (daylight saving included). The institution's own time-zone setting is still unset; it is needed only for timetables entered in the app.

## What is imported

| Route                  | Hours                                                                               | Rules and departures (from the Barone Campus Center)                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campus Shuttle         | Mon–Thu 7:30 a.m.–8:30 p.m.; Fri 7:30 a.m.–3:30 p.m.; Sat–Sun 9 a.m.–3:30 p.m.      | "Generally runs every 30 minutes" (wording only; no times generated). Mon–Fri 11 a.m.–3:30 p.m.: hourly at :30, so 11:30, 12:30, 1:30, 2:30 and 3:30.                                        |
| 1720 Post Road Shuttle | —                                                                                   | Mon–Fri: 10:45, 11:45, 12:45, 1:45. No published service on weekends.                                                                                                                        |
| Town Shuttle           | Mon–Fri 7 a.m.–9:50 p.m.; Sat–Sun from 12 p.m., **closing time needs confirmation** | "Approximately once every hour" (the introduction says "on the hour"; no times generated). Mon–Fri final departure 9:50 p.m. with its Dolan School of Business stop and on-demand drop-offs. |
| Bellarmine Bus Shuttle | Mon, Tue, Thu, Fri 8 a.m.–5 p.m.                                                    | The 5 p.m. trip is drop-off only (Bridgeport Train Station, Barone Campus Center). No published service Wednesday, Saturday or Sunday.                                                       |

Notes shown with every day: operates during the academic year only; no service on Columbus Day weekend, Thanksgiving weekend, Christmas semester recess, Martin Luther King Jr. Day, Easter recess or spring break (dates not published); subject to change.

**Town weekend conflict:** the introduction says the Town shuttle runs "on the hour beginning at noon Saturday and Sunday until 7 p.m."; the Town Shuttle section says "Saturday - Sunday | 12 p.m. - 9:50 p.m." Neither is chosen: weekends show "Weekend closing time needs confirmation", both times and the source link.

One reading to confirm: "from 11 a.m. to 3:30 p.m., runs hourly, departing … at 30 minutes past each hour" is taken to include a 3:30 p.m. departure.

## What the app does and does not claim

- No term or closure dates are published, so the status reads "Published weekly hours. Not confirmed for today". The app never says service is running today from these hours. A weekday with no published hours says "No published service on this day".
- No times at intermediate stops are published, so none are shown; stop rows say "No scheduled time published". Listed times are departures from the Barone Campus Center.
- An administrator-entered timetable or closure (Schedules → Publish a timetable) still works as before and is shown separately.
- Nothing is written to the database; other institutions are unaffected.

## Still missing (ask Fairfield Transportation)

1. Effective dates for the current term, and closure dates for this academic year.
2. Campus Shuttle departure times outside 11 a.m.–3:30 p.m. (exactly :00 and :30?).
3. Town Shuttle exact departure minutes, and the correct weekend closing time (7 p.m. or 9:50 p.m.).
4. Bellarmine Shuttle departure times from each end.
5. Minutes from the Barone Campus Center to each stop, for every route.

With term dates, set `calendar.confirmed` only after an administrator enters them as a service period, so a dated timetable decides whether service runs on a day.
