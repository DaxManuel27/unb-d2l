import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveSource } from '../unb-now/src/data/live-source.js';
import { currentTerm } from '../unb-now/src/data/term.js';
import { DEFAULT_SETTINGS } from '../unb-now/src/core/store.js';

const event = () => { const listeners = []; return { listeners, addListener(fn) { listeners.push(fn); } }; };
const until = async (predicate) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail('Background did not reach expected state');
};

test('fork worker scans, preserves check-offs, isolates accounts, schedules reminders, and deletes safely', async () => {
  let store = { state: {
    scan: { status: 'done', courses: [] }, student: { id: '7' }, lastSyncAt: new Date().toISOString(),
    courses: [{ id: 'ou101', name: 'Programming' }, { id: 'ou202', name: 'Calculus - Fall 2025' }],
    items: [
      { id: '101:dropbox:11', courseId: 'ou101', status: 'done', manualDone: true, dueAt: '2099-10-01T20:00:00Z' },
      { id: '202:dropbox:11', courseId: 'ou202', status: 'open', dueAt: '2099-10-01T20:00:00Z' }
    ]
  } };
  let user = '7';
  let due = '2099-10-01T20:00:00Z';
  let hold;
  let requested = false;
  const messages = event(), alarms = new Map(), notices = new Map();
  const oldFetchVia = LiveSource.prototype.fetchVia;
  LiveSource.prototype.fetchVia = async function(path) {
    if (hold) { requested = true; await hold; }
    let json = [];
    if (path.includes('/whoami')) json = { Identifier: user, FirstName: 'Synthetic', LastName: 'Student' };
    else if (path.includes('/myenrollments/')) json = { Items: [{ OrgUnit: { Id: 101, Name: `CS 1073 - Programming - ${currentTerm().label}`, Type: { Id: 3 } } }] };
    else if (path.endsWith('/dropbox/folders/')) json = [{ Id: 11, Name: 'Assignment 1', DueDate: due }];
    return { status: 200, type: 'application/json', json };
  };
  globalThis.self = { addEventListener() {} };
  globalThis.chrome = {
    runtime: { id: 'unb', getURL: (p) => `chrome-extension://unb/${p}`, onMessage: messages, onStartup: event(), onInstalled: event(), getManifest: () => ({ version: '0.4.0' }) },
    i18n: { getMessage: () => 'UNB Now' },
    storage: { onChanged: event(), local: {
      get: async (key) => ({ [key]: structuredClone(store[key]) }),
      set: async (value) => { Object.assign(store, structuredClone(value)); },
      clear: async () => { store = {}; }, setAccessLevel: async () => {}
    }, session: { get: async () => ({ startupChecked: true }) } },
    action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {}, setTitle: async () => {} },
    sidePanel: { setPanelBehavior: async () => {} },
    alarms: { onAlarm: event(), get: async (k) => alarms.get(k), create: async (k, v) => { alarms.set(k, v); }, clear: async (k) => alarms.delete(k) },
    notifications: { onClicked: event(), create: async (id, notice) => notices.set(id, notice), getAll: async () => Object.fromEntries(notices), clear: async (id) => notices.delete(id) },
    tabs: { query: async () => { assert.fail('Scanning must not interact with tabs when worker API access succeeds'); } }
  };
  try {
    await import('../unb-now/src/background.js');
    await until(() => alarms.has('live-sync'));
    const sender = { id: 'unb', url: 'chrome-extension://unb/panel/panel.html' };
    const send = (message, from = sender) => new Promise((resolve) => messages.listeners[0](message, from, resolve));
    assert.equal((await send({ type: 'data:delete' }, { id: 'unb', url: 'https://lms.unb.ca/d2l/home', tab: { id: 1 } })).ok, false);
    await send({ type: 'panel:opened' });
    await until(() => store.state?.scan.status === 'done' && store.state.termKey === currentTerm().key);
    assert.equal(store.state.student.id, '7');
    assert.equal(store.state.items.length, 1);
    assert.equal(store.state.items[0].status, 'done');
    assert.equal(store.state.courses.length, 1);
    assert.equal(store.state.carry, undefined);
    assert.equal(alarms.get('live-sync').periodInMinutes, 30);
    await send({ type: 'item:toggle-done', itemId: '101:dropbox:11' });
    assert.equal(store.state.items[0].status, 'open');
    await send({ type: 'item:toggle-done', itemId: '101:dropbox:11' });
    assert.equal(store.state.items[0].status, 'done');
    await send({ type: 'panel:refresh' });
    await until(() => store.state.syncing === false);
    assert.equal(store.state.items[0].status, 'done');
    user = '8';
    due = '2099-10-02T20:00:00Z';
    await send({ type: 'panel:refresh' });
    await until(() => store.state.student?.id === '8' && !store.state.syncing);
    assert.equal(store.state.items[0].status, 'open');
    assert.equal(store.state.items[0].moved, null);
    assert.ok(alarms.has('reminder'));
    assert.equal(notices.size, 0);
    let release;
    hold = new Promise((resolve) => { release = resolve; });
    await send({ type: 'panel:refresh' });
    await until(() => requested);
    await send({ type: 'data:delete' });
    hold = null;
    release();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(store.state.items.length, 0);
    assert.ok(store.state.deletedAt);
    assert.equal(alarms.has('reminder'), false);
    assert.equal(alarms.has('live-sync'), false);
    assert.equal(store.liveDebug, undefined);
    assert.equal(store.settings.mode, DEFAULT_SETTINGS.mode);
  } finally {
    LiveSource.prototype.fetchVia = oldFetchVia;
    delete globalThis.chrome;
    delete globalThis.self;
  }
});
