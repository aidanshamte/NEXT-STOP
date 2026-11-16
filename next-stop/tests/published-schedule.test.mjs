// Fairfield's published (undated) schedule: hours, frequency wording, explicit departures and
// notes from the official page, merged into /schedule for the day requested. Covers time zones
// (including daylight saving), weekday exceptions, the Town weekend conflict, and the line
// between published, administrator-entered and live data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness } from './harness.mjs';
import { loadPublishedSchedules } from '../server/published-schedule.mjs';
import { publishedLines, publishedStatus } from '../src/features/schedules/published.ts';

const SOURCE = 'https://www.fairfield.edu/student-life/campus-services/transportation-and-parking/';
const shipped = () => loadPublishedSchedules().get('Fairfield University');
const utc = (iso) => Date.parse(iso);

test('the shipped Fairfield schedule records only what the page states', () => {
  const plan = JSON.parse(
    readFileSync(
      new URL('../server/imports/fairfield-university-published-schedule.json', import.meta.url),
      'utf8',
    ),
  );
  const routes = JSON.parse(
    readFileSync(
      new URL('../server/imports/fairfield-university-shuttles.json', import.meta.url),
      'utf8',
    ),
  ).routes.map((r) => r.key);
  assert.equal(plan.source.url, SOURCE);
  assert.equal(plan.checkedAt, '2026-11-16');
  assert.equal(plan.timezone, 'America/New_York');
  assert.equal(plan.calendar.confirmed, false, 'no term dates are published');
  assert.deepEqual(Object.keys(plan.routes).sort(), [...routes].sort(), 'all four routes');
  for (const [key, r] of Object.entries(plan.routes))
    for (const k of Object.keys(r))
      assert.ok(['hours', 'rules', 'noServiceText'].includes(k), `${key}: no stop times (${k})`);
  const data = shipped();
  assert.equal(data.routes.size, 4, 'every route passes validation');
  const town = plan.routes['town-shuttle'].hours.find((h) => h.days === '0000011');
  assert.equal(town.end, null, 'no weekend closing time is chosen');
  assert.equal(town.endConflict.text, 'Weekend closing time needs confirmation');
  assert.deepEqual(town.endConflict.options, ['19:00', '21:50']);
  const post = plan.routes['1720-post-road-shuttle'].rules[0];
  assert.deepEqual(post.departures, ['10:45', '11:45', '12:45', '13:45']);
});

async function setup(t, options = {}) {
  const data = new Map([['Northbridge University', shipped()]]);
  const h = await harness(t, { publishedScheduleData: data, ...options });
  const db = h.app.db;
  const add = db.prepare(
    "INSERT INTO routes(id,institution_id,name,import_key) VALUES (?,'northbridge',?,?)",
  );
  add.run('campus', 'Campus Shuttle', 'campus-shuttle');
  add.run('town', 'Town Shuttle', 'town-shuttle');
  add.run('bell', 'Bellarmine Bus Shuttle', 'bellarmine-bus-shuttle');
  add.run('post', '1720 Post Road Shuttle', '1720-post-road-shuttle');
  db.prepare(
    "INSERT INTO routes(id,institution_id,name,import_key) VALUES ('lk','lakeside','Lake','campus-shuttle')",
  ).run();
  const student = h.as('northbridge-student');
  const day = async (date) => (await student.get('/schedule', `&date=${date}`)).data;
  const route = (s, id) => s.published.routes.find((r) => r.route_id === id);
  return { h, db, student, day, route };
}

test('published hours by weekday, in Fairfield’s time zone', async (t) => {
  const { h, db, day, route } = await setup(t);
  const before = JSON.stringify(db.prepare('SELECT * FROM routes ORDER BY id').all());

  // Monday 16 Nov 2026 (EST, UTC−5). No institution time zone set: the published zone is used.
  const mon = await day('2026-11-16');
  assert.equal(mon.configured, false, 'no administrator timetable');
  assert.equal(mon.timezone, 'America/New_York');
  assert.equal(mon.date, '2026-11-16');
  assert.equal(mon.published.source.url, SOURCE);
  assert.equal(mon.published.checkedAt, '2026-11-16');
  assert.equal(mon.published.calendar.confirmed, false);
  assert.equal(mon.routes, undefined, 'no scheduled departures are invented');
  const campus = route(mon, 'campus');
  assert.deepEqual(campus.hours, [
    { start: utc('2026-11-16T12:30:00Z'), end: utc('2026-11-17T01:30:00Z') },
  ]);
  assert.deepEqual(
    campus.rules.map((r) => r.departures.length),
    [0, 5],
    '“every 30 minutes” stays wording; only the stated :30 departures become times',
  );
  assert.equal(campus.rules[1].departures[0], utc('2026-11-16T16:30:00Z'));
  assert.deepEqual(route(mon, 'post').rules[0].departures, [
    utc('2026-11-16T15:45:00Z'),
    utc('2026-11-16T16:45:00Z'),
    utc('2026-11-16T17:45:00Z'),
    utc('2026-11-16T18:45:00Z'),
  ]);
  assert.equal(route(mon, 'bell').hours[0].start, utc('2026-11-16T13:00:00Z'));
  const townWeekday = route(mon, 'town');
  assert.equal(townWeekday.hours[0].end, utc('2026-11-17T02:50:00Z'));
  assert.equal(townWeekday.hours[0].endConflict, undefined);
  assert.ok(townWeekday.rules.some((r) => r.departures.includes(utc('2026-11-17T02:50:00Z'))));

  // Summer Monday (EDT, UTC−4): same local times, different UTC.
  const july = await day('2026-07-06');
  assert.equal(route(july, 'campus').hours[0].start, utc('2026-07-06T11:30:00Z'));
  // Daylight-saving change days (both Sundays): local 9:00 a.m. on each side of the change.
  assert.equal(
    route(await day('2026-11-01'), 'campus').hours[0].start,
    utc('2026-11-01T14:00:00Z'),
  );
  assert.equal(
    route(await day('2026-03-08'), 'campus').hours[0].start,
    utc('2026-03-08T13:00:00Z'),
  );

  // Weekday exceptions.
  const wed = await day('2026-11-18');
  assert.equal(route(wed, 'bell').noService, true, 'Bellarmine: no Wednesday service');
  assert.match(route(wed, 'bell').noServiceText, /No service on Wednesday/);
  assert.equal(route(wed, 'campus').hours[0].end, utc('2026-11-19T01:30:00Z'));
  const fri = await day('2026-11-20');
  assert.equal(route(fri, 'campus').hours[0].end, utc('2026-11-20T20:30:00Z'), 'Friday 3:30 p.m.');
  assert.equal(route(fri, 'campus').rules[1].departures.length, 5, 'weekday :30 exception');
  const sat = await day('2026-11-21');
  assert.equal(route(sat, 'campus').hours[0].start, utc('2026-11-21T14:00:00Z'), 'weekends 9 a.m.');
  assert.equal(route(sat, 'campus').rules.length, 1, 'the weekday :30 exception does not apply');
  assert.equal(route(sat, 'post').noService, true, '1720 Post Road: weekdays only');
  assert.equal(route(sat, 'bell').noService, true);

  // Town weekend: the conflict is shown, never resolved; no weekend final departure.
  const town = route(sat, 'town');
  assert.equal(town.hours[0].start, utc('2026-11-21T17:00:00Z'));
  assert.equal(town.hours[0].end, null);
  assert.equal(town.hours[0].endConflict.text, 'Weekend closing time needs confirmation');
  assert.deepEqual(town.hours[0].endConflict.options, [
    utc('2026-11-22T00:00:00Z'),
    utc('2026-11-22T02:50:00Z'),
  ]);
  assert.ok(town.rules.every((r) => r.departures.length === 0));

  // Other institutions are untouched, and nothing is written.
  const lake = (await h.as('lakeside-student').get('/schedule', '&date=2026-11-16')).data;
  assert.deepEqual(lake, { configured: false });
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM routes ORDER BY id').all()), before);
  const source = readFileSync(new URL('../server/published-schedule.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /INSERT|UPDATE|DELETE/);
});

test('“today” is the local date in Fairfield, not UTC', async (t) => {
  // 03:30 UTC on 17 Nov is still Monday 16 Nov, 10:30 p.m., in Fairfield.
  const { student } = await setup(t, { clock: () => utc('2026-11-17T03:30:00Z') });
  const s = (await student.get('/schedule')).data;
  assert.equal(s.date, '2026-11-16');
});

test('published, administrator-entered and live data stay separate', async (t) => {
  const { h, day, route } = await setup(t);
  const admin = h.as('northbridge-admin');
  await admin.post('/settings', { timezone: 'America/New_York' });
  const { id: periodId } = (
    await admin.post('/schedule/period', {
      name: 'Test term',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      days: '1111100',
    })
  ).data;
  await admin.post('/schedule/departures', { routeId: 'campus', periodId, times: ['08:05'] });
  await admin.post('/schedule/exception', { date: '2026-11-17', kind: 'closed', note: 'Snow' });

  const mon = await day('2026-11-16');
  assert.equal(mon.configured, true);
  assert.deepEqual(
    mon.routes.find((r) => r.route_id === 'campus').departures,
    [utc('2026-11-16T13:05:00Z')],
    'administrator departures are not mixed with published times',
  );
  assert.equal(route(mon, 'campus').rules[1].departures.length, 5, 'published shown alongside');
  const tue = await day('2026-11-17');
  assert.equal(tue.closed, true, 'an administrator closure still applies');
  assert.ok(tue.published, 'published hours still shown, with the closure');

  // Live data comes from the snapshot, never from the schedule.
  const snap = await h.as('northbridge-student').snapshot();
  assert.ok(!('published' in snap));
  assert.ok(!JSON.stringify(mon.published).includes('progress'));

  // The client never says the service is running from undated hours.
  assert.match(publishedStatus(mon.published, true), /Not confirmed for today/);
  assert.doesNotMatch(publishedStatus(mon.published, true), /running|operating|in service/i);
  const lines = publishedLines(route(await day('2026-11-21'), 'town'), 'America/New_York');
  assert.equal(lines.conflict.text, 'Weekend closing time needs confirmation');
  // 12- or 24-hour clock, depending on the device locale.
  assert.match(lines.hours[0], /^From 12:00.*; closing (7:00|19:00).* or (9:50|21:50)/);
  assert.match(publishedLines(route(mon, 'post'), 'America/New_York').rules[0].times, /10:45/);
  assert.match(
    publishedLines(route(await day('2026-11-18'), 'bell'), 'America/New_York').noService,
    /^No published service on this day\. No service on Wednesday/,
  );
});
