import assert from 'node:assert/strict';
import test from 'node:test';

function event() {
  const listeners = [];
  return { listeners, addListener(listener) { listeners.push(listener); } };
}

test('background limits messaging, persists settings locally, and clears data and alarms', async () => {
  let storage = {};
  let accessLevel;
  const alarms = new Map();
  const messages = event();
  const notificationCalls = [];
  globalThis.chrome = {
    runtime: {
      id: 'test-extension', getURL: (path) => `chrome-extension://test-extension/${path}`,
      onMessage: messages, onInstalled: event(), onStartup: event()
    },
    storage: {
      local: {
        get: async () => structuredClone(storage),
        set: async (value) => { storage = { ...storage, ...structuredClone(value) }; },
        clear: async () => { storage = {}; },
        setAccessLevel: async (value) => { accessLevel = value.accessLevel; }
      }
    },
    sidePanel: { setPanelBehavior: async () => {} },
    alarms: {
      get: async (key) => alarms.get(key),
      create: async (key, value) => { alarms.set(key, value); },
      clear: async (key) => alarms.delete(key),
      clearAll: async () => { alarms.clear(); },
      onAlarm: event()
    },
    permissions: { contains: async () => false },
    notifications: { onClicked: event(), create: async (...args) => notificationCalls.push(args) },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com' }], create: async () => { throw new Error('Unexpected navigation'); } }
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network access'); };
  try {
    await import('../extension/background.js');
    const handle = messages.listeners[0];
    const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/index.html' };
    const send = (message) => new Promise((resolve, reject) => {
      if (!handle(message, sender, resolve)) reject(new Error('Message rejected'));
    });
    const first = await send({ type: 'state' });
    assert.equal(first.ok, true);
    assert.equal(accessLevel, 'TRUSTED_CONTEXTS');
    assert.equal(alarms.has('planner-maintenance'), true);
    for (const url of ['https://lms.unb.ca/d2l/home', 'chrome-extension://test-extension/index.html.evil', 'invalid']) {
      assert.equal(handle({ type: 'clear' }, { ...sender, url }, () => {}), false);
    }
    const [one, two] = await Promise.all([
      send({ type: 'action', action: { type: 'settings', patch: { reminderTime: '07:30' } } }),
      send({ type: 'action', action: { type: 'settings', patch: { leadMinutes: [60] } } })
    ]);
    assert.equal(one.ok && two.ok, true);
    assert.equal(storage.planner.settings.reminderTime, '07:30');
    assert.deepEqual(storage.planner.settings.leadMinutes, [60]);
    const refresh = await send({ type: 'refresh' });
    assert.equal(refresh.state.scan.status, 'unsupported');
    assert.equal(refresh.state.scan.succeededAt, null);
    assert.equal(notificationCalls.length, 0);
    assert.equal((await send({ type: 'fetch', url: 'https://evil.example' })).ok, false);
    const cleared = await send({ type: 'clear' });
    assert.equal(cleared.ok, true);
    assert.deepEqual(storage, {});
    assert.equal(alarms.size, 0);
    assert.equal((await send({ type: 'state' })).state.settings.reminderTime, '08:00');
  } finally {
    globalThis.fetch = oldFetch;
    delete globalThis.chrome;
  }
});
