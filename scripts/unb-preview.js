import { currentTerm } from '/src/data/term.js';
// Browser-only fixture adapter. This file is never included in the extension.
(() => {
  const listeners = [];
  const date = (days, hour = 23) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 59, 0, 0); return d.toISOString(); };
  const courses = [
    { id: 'ou101', orgUnitId: 101, code: 'CS 1073', name: 'Introduction to Programming', color: 'blue' },
    { id: 'ou102', orgUnitId: 102, code: 'MATH 1003', name: 'Introduction to Calculus', color: 'pink' },
    { id: 'ou103', orgUnitId: 103, code: 'PHYS 1081', name: 'Foundations of Physics', color: 'green' }
  ].map((course) => ({ ...course, termKey: currentTerm().key }));
  const item = (id, courseId, title, category, days, extra = {}) => ({ id, courseId, title, category, kind: category === 'quiz' ? 'quiz' : 'dropbox', status: 'open', dueAt: date(days), url: '#', completedAt: null, moved: null, ...extra });
  let store = {
    settings: { mode: 'live', theme: 'light', learnBase: 'https://lms.unb.ca', reminders: { leads: { assignment: ['2d'], lab: ['2d'], quiz: ['1d'], discussion: ['morning'], content: ['morning'] }, offTypes: [], mutedCourses: [] } },
    state: { termKey: currentTerm().key, scan: { status: 'done', courses: [] }, student: { id: 'synthetic', name: 'Preview Student', initials: 'PS' }, courses, items: [
      item('101:dropbox:11', 'ou101', 'Assignment 1: Getting started', 'assignment', 0, { moved: { from: date(-2), at: new Date().toISOString() } }),
      item('102:dropbox:12', 'ou102', 'Problem set 2', 'assignment', 2),
      item('103:dropbox:13', 'ou103', 'Lab 1: Measurement', 'lab', 4),
      item('101:quiz:14', 'ou101', 'Quiz 2: Variables and expressions', 'quiz', 7),
      item('102:dropbox:15', 'ou102', 'Problem set 1', 'assignment', -2, { status: 'submitted', completedAt: date(-3) })
    ], seq: 0, sent: {}, lastSyncAt: new Date().toISOString(), syncing: false }
  };
  function update(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: structuredClone(store[key]), newValue: structuredClone(value) }; store[key] = structuredClone(value); }
    for (const listener of listeners) listener(changes, 'local');
  }
  window.chrome = {
    i18n: { getMessage: () => 'UNB Now' },
    runtime: {
      getURL: (path) => '/' + path,
      openOptionsPage: async () => {},
      sendMessage: async (message) => {
        if (message.type === 'item:toggle-done') {
          const state = structuredClone(store.state);
          const item = state.items.find((item) => item.id === message.itemId);
          if (item && item.status !== 'submitted') { item.status = item.status === 'done' ? 'open' : 'done'; state.seq++; state.lastEvent = null; update({ state }); }
        }
        if (message.type === 'data:delete') { update({ state: { ...store.state, courses: [], items: [], deletedAt: new Date().toISOString(), scan: { status: 'idle', courses: [] } } }); }
        return { ok: true };
      }
    },
    storage: { local: { get: async (key) => ({ [key]: structuredClone(store[key]) }), set: async (values) => update(values) }, onChanged: { addListener: (fn) => listeners.push(fn) } },
    tabs: { create: async () => {} }
  };
})();
