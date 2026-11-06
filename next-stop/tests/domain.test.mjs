import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationState, nextStatus, canEndService, occupancy } from '../src/domain.ts';
test('stale and unavailable positions cannot appear live', () => {
  const now = Date.now(),
    trip = { active: 1, lat: 41, lng: -73, updated_at: now };
  assert.equal(locationState(trip, now), 'live');
  assert.equal(locationState(trip, now + 31000), 'stale');
  assert.equal(locationState({ ...trip, lat: null }, now), 'offline');
  assert.equal(locationState({ ...trip, active: 0 }, now), 'offline');
});
test('boarding lifecycle and service-end guard include waiting and onboard riders', () => {
  assert.equal(nextStatus('requested'), 'accepted');
  assert.equal(nextStatus('boarded'), 'arrived');
  assert.equal(nextStatus('cancelled'), null);
  assert.equal(canEndService([{ trip_id: 'one', status: 'accepted' }], 'one'), false);
  assert.equal(canEndService([{ trip_id: 'one', status: 'arrived' }], 'one'), true);
  assert.equal(
    occupancy(
      [
        { trip_id: 'one', status: 'accepted' },
        { trip_id: 'one', status: 'boarded' },
        { trip_id: 'one', status: 'requested' },
      ],
      'one',
    ),
    2,
  );
});

test('driver-set lifecycle includes approaching and it holds a seat', () => {
  assert.equal(nextStatus('requested'), 'accepted');
  assert.equal(nextStatus('accepted'), 'approaching');
  assert.equal(nextStatus('approaching'), 'boarded');
  assert.equal(nextStatus('boarded'), 'arrived');
  assert.equal(nextStatus('arrived'), null);
  const reqs = [{ trip_id: 't', status: 'approaching' }];
  assert.equal(occupancy(reqs, 't'), 1);
  assert.equal(canEndService(reqs, 't'), false);
});
