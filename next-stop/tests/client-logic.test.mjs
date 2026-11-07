// Rider-facing calculations: live arrival ranges and their unavailable states, seat estimates,
// timetable summaries. Imports the app's own domain module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrival, headway, scheduledAt, seats } from '../src/domain.ts';

const now = Date.UTC(2026, 10, 2, 15);
const base = {
  id: 'bus',
  institution_id: 'x',
  driver_id: 'd',
  route_id: 'r',
  name: 'Shuttle',
  capacity: 20,
  active: 1,
  lat: 1,
  lng: 1,
  accuracy: 5,
  updated_at: now - 5000,
  delay_minutes: 0,
  issue: '',
  progress: { position: 0, stop_id: 'a', at: now - 60000 },
  estimates: [
    { position: 1, stop_id: 'b', low: 100, mid: 130, high: 170, samples: 4 },
    { position: 2, stop_id: 'c', low: 300, mid: 360, high: 460, samples: 3 },
  ],
  reason: null,
};

test('arrival estimates count down from the last stop passed, as a range', () => {
  // 60 s since passing A; C is 300–460 s from A: 4–7 min remaining.
  assert.deepEqual(arrival(base, 'c', now), { state: 'live', low: 4, high: 7, samples: 3 });
  // B: 100–170 s from A, 60 s elapsed: under 1 to 2 min.
  assert.deepEqual(arrival(base, 'b', now), { state: 'live', low: 0, high: 2, samples: 4 });
  assert.deepEqual(arrival(base, 'a', now), { state: 'here' });
});

test('no estimate without current GPS, route progress or enough history', () => {
  const why = (trip, stop = 'c', at = now) => {
    const r = arrival(trip, stop, at);
    return r.state === 'unavailable' ? r.why : r.state;
  };
  assert.match(why({ ...base, updated_at: now - 45000 }), /GPS is not current/);
  assert.match(why({ ...base, active: 0 }), /not in service/);
  assert.match(why({ ...base, progress: null, reason: 'no_progress' }), /pass a confirmed stop/);
  assert.match(why({ ...base, progress: null, reason: 'no_route' }), /no route/);
  assert.match(
    why({ ...base, estimates: [], reason: 'insufficient_history' }),
    /Not enough trip history/,
  );
  assert.match(why({ ...base, estimates: [], reason: 'overdue' }), /longer than usual/);
  assert.match(why(base, 'd'), /Not enough trip history/, 'stops beyond the known history');
  // Well past the top of the range: withdrawn rather than counting below zero.
  assert.match(
    why({ ...base, progress: { ...base.progress, at: now - 600000 } }, 'c'),
    /later than usual/,
  );
});

test('seat use is reported only while in service, from counts the server provides', () => {
  assert.equal(seats({ ...base, active: 0, onboard: 3 }).load, 'unknown');
  assert.deepEqual(seats({ ...base, onboard: 3, reserved: 1 }), {
    load: 'light',
    onboard: 3,
    reserved: 1,
    free: 16,
    capacity: 20,
  });
  assert.equal(seats({ ...base, onboard: 16, reserved: 0 }).load, 'near');
  assert.equal(seats({ ...base, onboard: 20, reserved: 2 }).free, 0);
  assert.equal(seats({ ...base, onboard: 20, reserved: 2 }).load, 'full');
});

test('timetable helpers: stop times from offsets, regular frequency detection', () => {
  const deps = [0, 15, 30, 45].map((m) => now + m * 60000);
  assert.deepEqual(
    scheduledAt(deps, 4),
    deps.map((d) => d + 240000),
  );
  assert.equal(scheduledAt(deps, null), null, 'no published time for that stop');
  assert.equal(headway(deps), 15);
  assert.equal(headway([now, now + 5 * 60000, now + 60 * 60000]), null, 'irregular');
});
