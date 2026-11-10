// What riders, drivers and staff are told about boarding assistance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANCE_OPTIONS, assistanceState, needsText } from '../src/domain.ts';

const base = {
  request_id: 'r',
  needs: ['ramp'],
  note: '',
  version: 1,
  status: 'pending',
  attention: '',
  ack_at: null,
  unable_at: null,
  staff_note: '',
  staff_at: null,
  updated_at: 0,
};

test('each assistance state has its own title and icon, not just a colour', () => {
  const states = [
    assistanceState(base),
    assistanceState({ ...base, status: 'acknowledged', ack_at: 1 }),
    assistanceState({ ...base, attention: 'vehicle_unknown' }),
    assistanceState({ ...base, status: 'unable', attention: 'driver_unable' }),
  ];
  assert.deepEqual(
    states.map((s) => s.title),
    [
      'Assistance requested',
      'Driver acknowledged',
      'Staff attention needed',
      'Driver unable to accommodate',
    ],
  );
  assert.equal(new Set(states.map((s) => s.icon)).size, 3);
  // Pending and acknowledged differ by icon as well as by colour.
  assert.notEqual(states[0].icon, states[1].icon);
});

test('acknowledgement is never described as a guarantee', () => {
  const ack = assistanceState({ ...base, status: 'acknowledged' });
  assert.match(ack.detail, /not a guarantee/);
  for (const status of ['pending', 'acknowledged', 'unable'])
    for (const attention of ['', 'driver_unable', 'vehicle_unavailable', 'vehicle_unknown']) {
      const s = assistanceState({ ...base, status, attention });
      assert.doesNotMatch(
        `${s.title} ${s.detail}`.replace(
          'This is not a guarantee that assistance is available.',
          '',
        ),
        /guarantee|will be available|is available/i,
      );
    }
});

test('staff attention explains the reason without medical wording', () => {
  assert.match(
    assistanceState({ ...base, attention: 'vehicle_unavailable' }).detail,
    /no ramp, lift or wheelchair space\. Staff have been alerted/,
  );
  assert.match(
    assistanceState({ ...base, attention: 'vehicle_unknown' }).detail,
    /hasn’t been confirmed/,
  );
  const all = ASSISTANCE_OPTIONS.map((o) => `${o.label} ${o.hint}`).join(' ');
  assert.doesNotMatch(all, /diagnos|condition|disabilit|medical/i);
  assert.equal(needsText(['ramp', 'extra_time']), 'Ramp or lift needed, Extra boarding time');
});
