import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ingestPage, linkedIdentity, parseBrightspaceDate } from '../extension/brightspace.js';
import { readBrightspacePage } from '../extension/brightspace-reader.js';
import { activeAccount, initialState } from '../extension/core.js';

function packet(overrides = {}) {
  return { status: 'read', accountId: '100', pageType: 'home', url: 'https://lms.unb.ca/d2l/home',
    courses: [{ id: '200', name: 'Synthetic course' }], rows: [], skipped: 0, limited: false, timeZone: null, ...overrides };
}
function ready() {
  const home = ingestPage(initialState(), packet());
  return ingestPage(home, packet({ pageType: 'settings', url: 'https://lms.unb.ca/d2l/lp/preferences/preferences_main/preferences_main.d2l?ou=1', timeZone: 'America/Halifax', courses: [] }));
}
function assignment(overrides = {}) {
  return { courseId: '200', activityId: '300', title: 'Synthetic assignment', dueText: 'Due on Oct 1, 2026 11:59 PM',
    closeText: 'Available until Oct 2, 2026 12:00 PM', submission: 'submitted',
    url: 'https://lms.unb.ca/d2l/lms/dropbox/user/folders_history.d2l?ou=200&db=300&grpid=0', ...overrides };
}
function assignmentPacket(rows = [assignment()]) {
  return packet({ pageType: 'assignments', url: 'https://lms.unb.ca/d2l/lms/dropbox/user/folders_list.d2l?ou=200', rows });
}

test('Brightspace dates convert from verified source timezone, including winter offset', () => {
  assert.equal(parseBrightspaceDate('Due on Oct 1, 2026 11:59 PM', 'America/Halifax').value, '2026-10-02T02:59:00.000Z');
  assert.equal(parseBrightspaceDate('Due on Nov 18, 2026 11:59 PM', 'America/Halifax').value, '2026-11-19T03:59:00.000Z');
  assert.equal(parseBrightspaceDate('Due on Oct 1, 2026 12:00 AM', 'America/Halifax').value, '2026-10-01T03:00:00.000Z');
  assert.equal(parseBrightspaceDate('Due on Oct 1, 2026 12:00 PM', 'America/Halifax').value, '2026-10-01T15:00:00.000Z');
});

test('ambiguous DST folds, nonexistent local times, unknown locale, and invalid dates are rejected', () => {
  for (const text of ['Nov 1, 2026 1:30 AM', 'Mar 8, 2026 2:30 AM', 'Oct 1, 2026 13:00 PM', 'Feb 30, 2026', '01/10/26', 'Due on 1 octobre 2026']) {
    assert.equal(parseBrightspaceDate(text, 'America/Halifax'), null, text);
  }
  assert.equal(parseBrightspaceDate('Oct 1, 2026 11:59 PM', null), null);
  assert.deepEqual(parseBrightspaceDate('Oct 1, 2026', null), { precision: 'date', value: '2026-10-01' });
});

test('assignment identity requires the same course and an observed read target', () => {
  assert.deepEqual(linkedIdentity(assignment().url, '200'), { identity: 'assignment:300', type: 'assignment' });
  assert.equal(linkedIdentity(assignment().url, '999'), null);
  assert.equal(linkedIdentity('https://evil.example/d2l/lms/dropbox/user/folders_history.d2l?ou=200&db=300', '200'), null);
});

test('manual assignment ingestion requires timezone and preserves independent closing date', () => {
  const unverified = ingestPage(initialState(), assignmentPacket());
  assert.equal(unverified.scan.status, 'timezone-needed');
  assert.equal(activeAccount(unverified).items.length, 0);
  const state = ingestPage(ready(), assignmentPacket());
  const item = activeAccount(state).items[0];
  assert.equal(item.due.value, '2026-10-02T02:59:00.000Z');
  assert.equal(item.closes.value, '2026-10-02T15:00:00.000Z');
  assert.equal(item.submission, 'submitted');
  assert.equal(state.scan.status, 'page-read');
});

test('Calendar machine timestamp merges with linked assignment without a false second-level conflict', () => {
  let state = ingestPage(ready(), assignmentPacket());
  const url = 'https://lms.unb.ca/d2l/le/calendar/200/event/400/detailsview';
  state = ingestPage(state, packet({ pageType: 'calendar-detail', url, rows: [{
    courseId: '200', eventId: '400', title: 'Synthetic assignment', dueEpoch: String(Date.parse('2026-10-02T02:59:59Z')),
    activityUrl: assignment().url, closeText: 'Ends Oct 2, 2026 12:00 PM'
  }] }));
  assert.equal(activeAccount(state).items.length, 1);
  assert.equal(activeAccount(state).items[0].sources.length, 2);
  assert.equal(activeAccount(state).items[0].conflict, false);
});

test('manual page reads never count as complete scans or delete cached items', () => {
  const populated = ingestPage(ready(), assignmentPacket());
  let state = ingestPage(populated, assignmentPacket([]));
  state = ingestPage(state, assignmentPacket([]));
  assert.equal(activeAccount(state).items[0].archived, false);
  assert.equal(activeAccount(state).items[0].sources[0].missing, 0);
  state = ingestPage(state, { status: 'layout-unverified' });
  assert.deepEqual(state.accounts, populated.accounts);
});

test('changing accounts does not reuse another account timezone or coursework', () => {
  const previous = ingestPage(ready(), assignmentPacket());
  const state = ingestPage(previous, { ...assignmentPacket(), accountId: '999' });
  assert.equal(activeAccount(state).items.length, 0);
  assert.equal(activeAccount(state).timeZone, null);
  assert.equal(state.accounts.length, 2);
});

test('collector rejects unsupported pages before reading page content', () => {
  for (const url of ['https://outside.example', 'https://lms.unb.ca/d2l/le/content/1/viewContent/2/View', 'https://lms.unb.ca/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=1&db=2']) {
    const context = vm.createContext({ URL, location: new URL(url), document: new Proxy({}, { get() { throw new Error('Must not inspect'); } }) });
    assert.equal(vm.runInContext(`(${readBrightspacePage.toString()})()`, context).status, 'unsupported');
  }
});

test('collector reads only scoped identity and DOM, with no credentials, network, or mutations', () => {
  const progressLink = { getAttribute: () => '/d2l/le/userprogress/100/200/Summary' };
  const navigation = { querySelectorAll: () => [progressLink] };
  const document = {
    querySelector: (selector) => selector === '.d2l-navigation-s-personal-menu' ? navigation : null,
    querySelectorAll: () => []
  };
  const forbidden = new Proxy({}, { get() { throw new Error('Forbidden API accessed'); } });
  const context = vm.createContext({ URL, location: new URL('https://lms.unb.ca/d2l/home'), document,
    chrome: forbidden, localStorage: forbidden, navigator: forbidden,
    fetch() { throw new Error('Network request attempted'); }
  });
  const result = vm.runInContext(`(${readBrightspacePage.toString()})()`, context);
  assert.equal(result.status, 'read');
  assert.equal(result.accountId, '100');
  assert.equal(result.courses.length, 0);
});
