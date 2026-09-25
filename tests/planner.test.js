import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { activeAccount, applyAction, dateKey, dueBoundary, groupName, initialState, reconcileScan, reminderPlan, reminderTimes, safeSourceUrl, updateSettings, validDate, visibleItems } from '../extension/core.js';
import { demoState } from '../extension/demo.js';

function fixture(overrides = {}) {
  return {
    sourceId: 'assignment-1', courseId: 'course-1', identity: 'assignment:1', title: 'Assignment 1', type: 'assignment',
    kind: 'deadline', source: 'activity', due: { precision: 'time', value: '2026-10-01T17:00:00Z' },
    url: 'https://lms.unb.ca/d2l/home/1', submission: 'unknown', ...overrides
  };
}
function scan(observations = [fixture()], overrides = {}) {
  return { status: 'success', accountId: 'student-1', courses: [{ id: 'course-1', name: 'Sample course' }], observations, scopes: [], ...overrides };
}
function populated(observations, overrides) { return reconcileScan(initialState(), scan(observations, overrides), '2026-09-24T12:00:00Z'); }

test('default reminders match confirmed scope', () => {
  const state = initialState();
  assert.equal(state.settings.reminderTime, '08:00');
  assert.deepEqual(state.settings.types, ['assignment', 'test', 'quiz', 'exam']);
  assert.deepEqual(state.settings.leadMinutes, []);
});

test('requires date precision and explicit timestamp timezone', () => {
  assert.equal(validDate({ precision: 'date', value: '2026-02-30' }), false);
  assert.equal(validDate({ precision: 'time', value: '2026-09-24T08:00:00' }), false);
  assert.equal(validDate({ precision: 'time', value: '2026-02-30T08:00:00Z' }), false);
  assert.equal(validDate({ precision: 'date', value: '2028-02-29' }), true);
});

test('linked sources merge by explicit identity with activity date priority and visible conflict', () => {
  const item = fixture();
  const state = populated([item, fixture({ sourceId: 'calendar-1', source: 'calendar', due: { precision: 'time', value: '2026-10-02T17:00:00Z' } })]);
  const account = activeAccount(state);
  assert.equal(account.items.length, 1);
  assert.equal(account.items[0].sources.length, 2);
  assert.deepEqual(account.items[0].due, item.due);
  assert.equal(account.items[0].conflict, true);
});

test('same title and date never merge unrelated identities or courses', () => {
  const state = populated([fixture(), fixture({ sourceId: 'assignment-2', identity: 'assignment:2' }), fixture({ courseId: 'course-2' })], {
    courses: [{ id: 'course-1', name: 'One' }, { id: 'course-2', name: 'Two' }]
  });
  assert.equal(activeAccount(state).items.length, 3);
});

test('equivalent timezone offsets do not create false conflicts or history', () => {
  let state = populated([fixture(), fixture({ source: 'calendar', sourceId: 'calendar-1', due: { precision: 'time', value: '2026-10-01T14:00:00-03:00' } })]);
  assert.equal(activeAccount(state).items[0].conflict, false);
  state = reconcileScan(state, scan([fixture({ due: { precision: 'time', value: '2026-10-01T14:00:00-03:00' } })]));
  assert.equal(activeAccount(state).items[0].history.length, 0);
});

test('uncertain account identity hides prior account records', () => {
  const state = reconcileScan(populated(), { status: 'account-unknown' });
  assert.equal(visibleItems(state).length, 0);
  assert.equal(state.accounts[0].items.length, 1);
});

test('date changes are recorded once and keep manual check-offs', () => {
  let state = populated();
  const id = activeAccount(state).items[0].id;
  state = applyAction(state, { type: 'complete', id, value: true });
  const changed = fixture({ due: { precision: 'time', value: '2026-10-03T17:00:00Z' } });
  state = reconcileScan(state, scan([changed]), '2026-09-25T12:00:00Z');
  state = reconcileScan(state, scan([changed]), '2026-09-26T12:00:00Z');
  assert.equal(activeAccount(state).items[0].history.length, 1);
  assert.equal(activeAccount(state).items[0].manualComplete, true);
});

test('offline, signed-out, and partial scans never delete cached deadlines', () => {
  const original = populated();
  for (const status of ['offline', 'signed-out', 'failed']) {
    const result = reconcileScan(original, { status });
    assert.deepEqual(result.accounts, original.accounts);
    assert.equal(result.scan.succeededAt, original.scan.succeededAt);
  }
  const partial = reconcileScan(original, scan([], { partial: true }));
  assert.equal(activeAccount(partial).items[0].archived, false);
});

test('removal requires two successful complete scans and respects surviving sources', () => {
  let state = populated([fixture(), fixture({ source: 'calendar', sourceId: 'calendar-1' })]);
  const absent = scan([], { scopes: [{ courseId: 'course-1', source: 'activity', complete: true }] });
  state = reconcileScan(state, absent);
  assert.equal(activeAccount(state).items[0].notFound, true);
  state = reconcileScan(state, absent);
  assert.equal(activeAccount(state).items[0].archived, false);
  const allAbsent = scan([], { scopes: [{ courseId: 'course-1', source: 'calendar', complete: true }] });
  state = reconcileScan(state, allAbsent);
  state = reconcileScan(state, allAbsent);
  assert.equal(activeAccount(state).items[0].archived, true);
});

test('unknown submission does not imply completion or erase known evidence', () => {
  let state = populated();
  assert.equal(activeAccount(state).items[0].submission, 'unknown');
  state = reconcileScan(state, scan([fixture({ submission: 'submitted' })]));
  state = reconcileScan(state, scan([fixture({ submission: 'unknown' })]));
  assert.equal(activeAccount(state).items[0].submission, 'submitted');
  assert.equal(activeAccount(state).items[0].submissionUnknown, true);
  state = applyAction(state, { type: 'complete', id: activeAccount(state).items[0].id, value: true });
  state = reconcileScan(state, scan([fixture({ submission: 'absent' })]));
  assert.equal(activeAccount(state).items[0].submission, 'absent');
  assert.equal(activeAccount(state).items[0].manualComplete, true);
});

test('quiz completion is not inferred from assignment submission semantics', () => {
  const state = populated([fixture({ type: 'quiz', submission: 'submitted' })]);
  assert.equal(activeAccount(state).items[0].submission, 'unknown');
});

test('different accounts have separate courses, items, and check-offs', () => {
  let state = populated();
  state = applyAction(state, { type: 'complete', id: activeAccount(state).items[0].id, value: true });
  state = reconcileScan(state, scan(undefined, { accountId: 'student-2' }));
  assert.equal(state.accounts.length, 2);
  assert.equal(activeAccount(state).items[0].manualComplete, false);
  assert.equal(visibleItems(state).length, 1);
});

test('hidden courses leave shared views and reminder plans but retain records', () => {
  let state = populated();
  state = applyAction(state, { type: 'course', id: 'course-1', visible: false });
  assert.equal(visibleItems(state).length, 0);
  assert.equal(activeAccount(state).items.length, 1);
  assert.equal(reminderPlan(state, Date.parse('2026-10-01T16:00:00Z')).due.length, 0);
});

test('date-only deadline expires at next local day, not at midnight on the due date', () => {
  const due = { precision: 'date', value: '2026-10-01' };
  const state = populated([fixture({ due })]);
  const item = activeAccount(state).items[0];
  assert.equal(groupName(item, new Date(2026, 9, 1, 23, 59)), 'Today');
  assert.equal(groupName(item, new Date(2026, 9, 2)), 'Overdue');
  assert.equal(dueBoundary(due), new Date(2026, 9, 2).getTime());
});

test('8am default and earlier-deadline exception use local time', () => {
  const settings = initialState().settings;
  const early = fixture({ due: { precision: 'time', value: new Date(2026, 9, 1, 7, 0).toISOString() } });
  const exact = fixture({ due: { precision: 'time', value: new Date(2026, 9, 1, 8, 0).toISOString() } });
  const late = fixture({ due: { precision: 'time', value: new Date(2026, 9, 1, 23, 0).toISOString() } });
  assert.equal(new Date(reminderTimes(early, settings)[0].at).getHours(), 6);
  assert.equal(new Date(reminderTimes(exact, settings)[0].at).getHours(), 7);
  assert.equal(new Date(reminderTimes(late, settings)[0].at).getHours(), 8);
});

test('early reminder can land on the previous local date', () => {
  const item = fixture({ due: { precision: 'time', value: new Date(2026, 9, 1, 0, 30).toISOString() } });
  const time = new Date(reminderTimes(item, initialState().settings)[0].at);
  assert.equal(dateKey(time), '2026-09-30');
  assert.equal(time.getHours(), 23);
});

test('catch-up combines thresholds, deduplicates, and skips past deadlines', () => {
  const due = { precision: 'time', value: new Date(2026, 9, 1, 17).toISOString() };
  let state = populated([fixture({ due })]);
  state = updateSettings(state, { leadMinutes: [60, 1440] });
  const now = new Date(2026, 9, 1, 16, 30).getTime();
  const plan = reminderPlan(state, now);
  assert.equal(plan.due.length, 1);
  assert.equal(plan.due[0].keys.length, 3);
  for (const key of plan.due[0].keys) state.deliveries[key] = { at: now };
  assert.equal(reminderPlan(state, now).due.length, 0);
  assert.equal(reminderPlan(populated([fixture({ due })]), new Date(2026, 9, 1, 18).getTime()).due.length, 0);
});

test('changed due date gets a new delivery identity', () => {
  let state = populated([fixture({ due: { precision: 'date', value: '2026-10-01' } })]);
  const first = reminderPlan(state, new Date(2026, 9, 1, 12).getTime());
  for (const key of first.due[0].keys) state.deliveries[key] = { at: 1 };
  state = reconcileScan(state, scan([fixture({ due: { precision: 'date', value: '2026-10-02' } })]));
  assert.equal(reminderPlan(state, new Date(2026, 9, 2, 12).getTime()).due.length, 1);
});

test('equivalent due timestamps keep delivery identity; reverting a changed date gets a new revision', () => {
  let state = populated();
  const now = Date.parse('2026-10-01T16:30:00Z');
  const first = reminderPlan(state, now);
  for (const key of first.due[0].keys) state.deliveries[key] = { at: now };
  state = reconcileScan(state, scan([fixture({ due: { precision: 'time', value: '2026-10-01T14:00:00-03:00' } })]));
  assert.equal(reminderPlan(state, now).due.length, 0);
  state = reconcileScan(state, scan([fixture({ due: { precision: 'time', value: '2026-10-02T17:00:00Z' } })]));
  state = reconcileScan(state, scan([fixture()]));
  assert.equal(reminderPlan(state, now).due.length, 1);
});

test('date-only reminders keep 8am across daylight-saving boundaries', () => {
  for (const value of ['2026-03-08', '2026-11-01']) {
    const reminder = reminderTimes(fixture({ due: { precision: 'date', value } }), initialState().settings)[0];
    assert.equal(new Date(reminder.at).getHours(), 8);
    assert.equal(dateKey(new Date(reminder.at)), value);
  }
});

test('completed, muted, event-only, and unknown-account records never generate reminders', () => {
  const now = new Date(2026, 9, 1, 12).getTime();
  const original = populated([fixture({ due: { precision: 'date', value: '2026-10-01' } })]);
  const id = activeAccount(original).items[0].id;
  const variants = [
    applyAction(original, { type: 'complete', id, value: true }),
    applyAction(original, { type: 'course', id: 'course-1', muted: true }),
    updateSettings(original, { reminders: false }),
    updateSettings(original, { types: ['quiz'] }),
    reconcileScan(original, { status: 'account-unknown' }),
    populated([fixture({ kind: 'event', due: null, eventDate: { precision: 'date', value: '2026-10-01' } })])
  ];
  for (const state of variants) assert.equal(reminderPlan(state, now).due.length, 0);
});

test('unsafe source URLs and malformed observations are rejected atomically', () => {
  for (const url of ['javascript:alert(1)', 'https://evil.example/d2l/home', 'https://lms.unb.ca@evil.example/d2l/home', 'https://name:password@lms.unb.ca/d2l/home']) {
    assert.equal(safeSourceUrl(url), null);
    assert.throws(() => populated([fixture({ url })]));
  }
  const state = populated();
  const snapshot = structuredClone(state);
  assert.throws(() => reconcileScan(state, scan([fixture({ due: { precision: 'date', value: 'not a date' } })])));
  assert.deepEqual(state, snapshot);
});

test('invalid settings cannot overwrite valid configuration', () => {
  const original = initialState();
  for (const patch of [{ reminderTime: '25:00' }, { leadMinutes: [-1] }, { leadMinutes: [Infinity] }, { types: ['secret'] }]) {
    assert.throws(() => updateSettings(original, patch));
  }
  assert.equal(original.settings.reminderTime, '08:00');
});

test('demo state is separate from real state', () => {
  const real = initialState();
  const demo = demoState();
  assert.equal(demo.activeAccount, 'demo');
  assert.equal(real.accounts.length, 0);
  assert.ok(activeAccount(demo).items.length > 0);
});

test('production manifest requests no LMS access, credentials, or remote connections before validation', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'alarms', 'activeTab', 'scripting']);
  assert.deepEqual(manifest.optional_permissions, ['notifications']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['https://lms.unb.ca/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});
