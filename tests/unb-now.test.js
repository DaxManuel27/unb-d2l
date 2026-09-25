import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { LiveSource, liveBase, parseCourseName } from '../unb-now/src/data/live-source.js';
import { LMS_BASE, apiPath, accessibleEnrollments, trustedMessage, lmsUrl } from '../unb-now/src/data/unb.js';
import { DEFAULT_SETTINGS } from '../unb-now/src/core/store.js';
import { currentTerm, termsFromText, matchesTerm, applyCurrentTerm } from '../unb-now/src/data/term.js';
import { plannedReminders } from '../unb-now/src/core/reminders.js';

const now = new Date('2026-09-24T12:00:00Z');
const enrollment = (id, name = 'CS 1073 - Introduction to Programming - Fall 2026', access = {}) => ({ OrgUnit: { Id: id, Name: name, Code: 'CS1073_UNB', Type: { Id: 3 } }, Access: access });
const response = (json, status = 200) => ({ status, type: 'application/json', json });
const sourceWith = (read) => {
  const source = new LiveSource(DEFAULT_SETTINGS, { now });
  source.fetchVia = async (path, via) => response(await read(new URL(path, LMS_BASE), via));
  return source;
};

test('UNB course labels use the actual course code instead of the semester', async () => {
  const mergedName = 'Fall 2026 Electric Circuits (ECE-2711-FR01A, ECE-2711-FR02A, ECE-2711-FR03A, ECE-2711-FR04A)';
  const merged = { code: 'ECE 2711', name: 'Electric Circuits' };
  assert.deepEqual(parseCourseName(mergedName, '7585f666-6da2-4e2e-a988-34576ef90b40'), merged);
  assert.deepEqual(parseCourseName('2026/FA_ECE_2215_FR01A', 'D2L_2026FA_UG_ECE_2215_FR01A_123456'), { code: 'ECE 2215', name: '' });
  assert.deepEqual(parseCourseName('2026/FA_MATH_3413_FR01A'), { code: 'MATH 3413', name: '' });
  assert.deepEqual(parseCourseName('ECE2021 Fall 2026 Tuesday Section'), { code: 'ECE 2021', name: 'Tuesday Section' });
  assert.deepEqual(parseCourseName('Circuits Lab', 'D2L_2026FA_UG_ECE_2215_FR01A_123456'), { code: 'ECE 2215', name: 'Circuits Lab' });
  for (const term of ['Fall 2026', 'Winter 2027', 'Summer 2026']) {
    assert.equal(parseCourseName(`${term} Electric Circuits (ECE-2711-FR01A)`).code, 'ECE 2711');
  }
  const rows = [enrollment(101, mergedName), { OrgUnit: { Id: 102, Type: { Id: 5 }, Name: 'Fall 2026' } }];
  const source = sourceWith((url) => url.pathname.endsWith('/versions/') ? [] : { Items: rows });
  const courses = await source.listCourses();
  assert.deepEqual(courses.map(({ code, name }) => ({ code, name })), [merged]);
});

test('current semester uses Atlantic boundaries and recognizes UNB course labels', () => {
  for (const [instant, key] of [
    ['2026-09-01T02:59:59Z', '2026-SU'], ['2026-09-01T03:00:00Z', '2026-FA'],
    ['2027-01-01T03:59:59Z', '2026-FA'], ['2027-01-01T04:00:00Z', '2027-WI'],
    ['2027-05-01T02:59:59Z', '2027-WI'], ['2027-05-01T03:00:00Z', '2027-SU'],
  ]) assert.equal(currentTerm(new Date(instant)).key, key);
  const term = currentTerm(now);
  for (const label of ['D2L_2026FA_UG_ECE_2215_FR01A_123456', '2026/FA_MATH_3413_FR01A', 'ECE2021 Fall 2026 Tuesday Section', 'Fall 2026 Electric Circuits']) {
    assert.equal(matchesTerm(termsFromText(label), term), true, label);
  }
  for (const label of ['MATH 1269', 'MATH2026', 'Fall 2025', 'Winter 2027', 'ONLINE', 'Fall 2026 and Winter 2027']) {
    assert.equal(matchesTerm(termsFromText(label), term), false, label);
  }
});

test('only current enrollments enter coursework requests; unnamed shells use parent semester', async () => {
  const calls = [];
  const rows = [
    enrollment(101, '2026/FA_ECE_2215_FR01A'),
    enrollment(102, 'Electric Circuits'),
    enrollment(103, 'Winter 2026 Calculus'),
    enrollment(104, 'Winter 2027 Calculus'),
    enrollment(105, 'Orientation'),
    enrollment(106, 'Fall 2026 Private', { CanAccess: false }),
  ];
  const source = sourceWith((url) => {
    calls.push(url);
    if (url.pathname.endsWith('/versions/')) return [];
    if (url.pathname.endsWith('/102/parentOrgUnits')) return { Items: [{ OrgUnit: { Name: 'Fall 2026' } }] };
    if (url.pathname.endsWith('/105/parentOrgUnits')) throw Object.assign(new Error('Denied'), { code: 'forbidden' });
    if (url.pathname.endsWith('/myenrollments/')) return { Items: rows };
    return [];
  });
  const courses = await source.listCourses();
  assert.deepEqual(courses.map((c) => c.orgUnitId).sort(), [101, 102]);
  for (const course of courses) await source.listDeadlines(course);
  assert.equal(source.report.term.unresolved, 1);
  assert.deepEqual([...source.courseIds].sort(), [101, 102]);
  assert.ok(calls.some((url) => url.searchParams.has('orgUnitIdsCSV')));
  for (const url of calls) {
    assert.doesNotMatch(url.pathname, /\/le\/[^/]+\/(103|104|105|106)\//);
    if (url.searchParams.has('orgUnitIdsCSV')) assert.deepEqual(url.searchParams.get('orgUnitIdsCSV').split(',').sort(), ['101', '102']);
  }
});

test('old and unknown cached courses stay hidden during migration, failed restores, and term changes', () => {
  const courses = [
    { id: 'current', termKey: '2026-FA' }, { id: 'old', termKey: '2026-WI' },
    { id: 'future', termKey: '2027-WI' }, { id: 'unknown', name: 'Programming' },
  ];
  const items = courses.map((course) => ({ id: course.id, courseId: course.id, status: 'done' }));
  const legacy = { courses, items, scan: { status: 'done', courses: courses.map((course) => ({ courseId: course.id })) } };
  const filtered = applyCurrentTerm(legacy, now);
  assert.deepEqual(filtered.courses, [courses[0]]);
  assert.deepEqual(filtered.items, [items[0]]);
  assert.deepEqual(filtered.scan.courses, [{ courseId: 'current' }]);
  assert.equal(filtered.needsTermRefresh, true);
  assert.deepEqual(filtered.carry.items, items, 'carry preserves check-offs for reconciliation');
  assert.deepEqual(applyCurrentTerm({ ...legacy, ...filtered.carry }, now).items, [items[0]]);
  assert.deepEqual(applyCurrentTerm({ ...legacy, termKey: '2026-FA' }, new Date('2027-01-01T04:00:00Z')).courses, [courses[2]]);
  assert.equal(applyCurrentTerm({ ...filtered, termKey: '2026-FA' }, now).needsTermRefresh, false);
});

test('UNB host, four-digit course names, and enrollment access replace Waterloo assumptions', async () => {
  assert.equal(liveBase({ liveBaseOverride: 'http://localhost:8080' }), LMS_BASE);
  assert.deepEqual(parseCourseName('CS 1073 - Introduction to Programming - Fall 2026'), { code: 'CS 1073', name: 'Introduction to Programming' });
  assert.equal(parseCourseName('Calculus', 'MATH1003_2026').code, 'MATH 1003');
  assert.equal(termsFromText('MATH 1269').size, 0);
  const rows = [enrollment(1), enrollment(2, 'MATH 1003 - Calculus - Winter 2026'), enrollment(3, 'Old', { EndDate: '2025-12-31' }), enrollment(4, 'Private', { CanAccess: false }), enrollment(5, 'Soon', { StartDate: '2026-10-01' })];
  assert.deepEqual(accessibleEnrollments(rows, now.getTime()).map((r) => r.OrgUnit.Id), [1, 2, 5]);
  const source = sourceWith((url) => url.pathname.endsWith('/versions/') ? [{ ProductCode: 'lp', LatestVersion: '1.50' }] : { Items: rows });
  const courses = await source.listCourses();
  assert.equal(courses.length, 1);
  assert.equal(courses[0].termKey, '2026-FA');
  assert.ok(courses.every((c) => c.current && c.homeUrl.startsWith(LMS_BASE)));
});

test('API transport only allows known UNB read routes', async () => {
  for (const path of ['/d2l/api/versions/', '/d2l/api/lp/1.50/enrollments/myenrollments/101/parentOrgUnits', '/d2l/api/lp/1.50/users/whoami', '/d2l/api/le/1.90/12/dropbox/folders/3/submissions/mysubmissions/', '/d2l/api/le/1.90/content/myItems/completions/due/?orgUnitIdsCSV=12']) assert.equal(apiPath(path), path);
  for (const path of ['https://evil.test/d2l/api/versions/', '/d2l/api/../home', '/d2l/api/%2e%2e/home', '/d2l/api/le/1.90/12/quizzes/3/attempts/', '/d2l/api/versions/#x', '/d2l/api/versions/\\x']) assert.equal(apiPath(path), null);
  assert.equal(lmsUrl('https://lms.unb.ca.evil.test/d2l/home'), null);
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('[]', { headers: { 'content-type': 'application/json' } }); };
  try {
    const source = new LiveSource(DEFAULT_SETTINGS);
    await source.api('/d2l/api/versions/');
    await assert.rejects(source.api('/d2l/api/../home'), { code: 'unsupported-route' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, LMS_BASE + '/d2l/api/versions/');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.credentials, 'include');
  } finally { globalThis.fetch = original; }
});

test('worker sign-in failures fall back to the existing UNB tab session', async () => {
  const source = sourceWith((url) => url.pathname.endsWith('/versions/') ? [] : { Identifier: '7', FirstName: 'Test', LastName: 'Student' });
  const calls = [];
  source.relay = () => {};
  source.fetchVia = async (path, via) => {
    calls.push(via);
    if (via === 'worker') return response(undefined, 401);
    return response(path.endsWith('/versions/') ? [] : { Identifier: '7', FirstName: 'Test', LastName: 'Student' });
  };
  const session = await source.checkSession();
  assert.equal(session.signedIn, true);
  assert.equal(session.student.id, '7');
  assert.equal(session.via, 'tab');
  assert.ok(calls.includes('worker') && calls.includes('tab'));
});

test('pagination follows bookmarks and refuses loops or off-host next links', async () => {
  const path = '/d2l/api/lp/1.50/enrollments/myenrollments/';
  const source = sourceWith((url) => url.searchParams.has('bookmark') ? { Items: [enrollment(2)] } : { Items: [enrollment(1)], PagingInfo: { HasMoreItems: true, Bookmark: 'page2' } });
  assert.equal((await source.paged(path)).length, 2);
  for (const page of [ { Items: [], Next: 'https://evil.test/d2l/api/versions/' }, { Items: [], Next: path }, { Items: [], PagingInfo: { HasMoreItems: true } } ]) {
    source.fetchVia = async () => response(page);
    await assert.rejects(source.paged(path), { code: 'pagination' });
  }
});

function courseworkSource({ quizFails = false } = {}) {
  const source = sourceWith((url) => {
    const p = url.pathname;
    if (p.endsWith('/versions/')) return [{ ProductCode: 'lp', LatestVersion: '1.50' }, { ProductCode: 'le', LatestVersion: '1.90' }];
    if (p.endsWith('/whoami')) return { Identifier: '7', FirstName: 'Test', LastName: 'Student' };
    if (p.includes('/myenrollments/')) return { Items: [enrollment(101)] };
    if (p.endsWith('/dropbox/folders/')) return [{ Id: 11, Name: 'Assignment 1', DueDate: '2026-10-01T20:00:00Z', Availability: {} }];
    if (p.includes('/mysubmissions/')) return [{ Submissions: [{ SubmissionDate: '2026-09-24T10:00:00Z' }] }];
    if (p.endsWith('/quizzes/')) {
      if (quizFails) throw Object.assign(new Error('Denied'), { code: 'forbidden' });
      return { Objects: [{ QuizId: 12, Name: 'Quiz 1', EndDate: '2026-10-02T20:00:00Z' }] };
    }
    if (p.endsWith('/discussions/forums/')) return [{ ForumId: 13 }];
    if (p.endsWith('/topics/')) return [{ TopicId: 14, Name: 'Discussion 1', DueDate: '2026-10-03T20:00:00Z' }];
    if (p.includes('/content/myItems/')) return { Objects: [] };
    if (p.includes('/calendar/events/')) return { Objects: [] };
    throw new Error(`Unexpected request ${p}`);
  });
  return source;
}

test('UNB API responses become assignments, quizzes and discussions with submission evidence', async () => {
  const source = courseworkSource();
  const session = await source.checkSession();
  const courses = await source.listCourses();
  const items = await source.listDeadlines(courses[0]);
  assert.equal(session.student.id, '7');
  assert.equal(courses[0].code, 'CS 1073');
  assert.deepEqual(items.map((i) => i.kind).sort(), ['discussion', 'dropbox', 'quiz']);
  assert.equal(items.find((i) => i.kind === 'dropbox').status, 'submitted');
  assert.ok(items.every((i) => lmsUrl(i.url)));
  assert.equal(source.readOk.get('ou101').size, 5);
  assert.equal((await source.submissionState(items.find((i) => i.kind === 'dropbox'))).submitted, true);
});

test('one denied API does not discard other coursework or claim complete coverage', async () => {
  const source = courseworkSource({ quizFails: true });
  const [course] = await source.listCourses();
  const items = await source.listDeadlines(course);
  assert.equal(items.length, 2);
  assert.equal(source.readOk.get(course.id).has('quizzes'), false);
  assert.equal(source.readOk.get(course.id).has('dropbox'), true);
});

test('reminders respect submission, manual completion, type preferences and course muting', () => {
  const item = { id: '101:dropbox:11', courseId: 'ou101', category: 'assignment', status: 'open', dueAt: '2026-10-01T20:00:00Z' };
  const settings = structuredClone(DEFAULT_SETTINGS);
  assert.equal(plannedReminders([item], settings, now).length, 1);
  for (const status of ['done', 'submitted']) assert.equal(plannedReminders([{ ...item, status }], settings, now).length, 0);
  settings.reminders.mutedCourses = ['ou101'];
  assert.equal(plannedReminders([item], settings, now).length, 0);
  settings.reminders.mutedCourses = [];
  settings.reminders.offTypes = ['assignment'];
  assert.equal(plannedReminders([item], settings, now).length, 0);
});

test('only extension views can mutate data; UNB tabs can only announce a page load', () => {
  const runtime = { id: 'unb', getURL: (p) => `chrome-extension://unb/${p}` };
  const tab = { id: 'unb', url: LMS_BASE + '/d2l/home', tab: { id: 2 } };
  assert.equal(trustedMessage({ type: 'data:delete' }, tab, runtime), false);
  assert.equal(trustedMessage({ type: 'live:learn-page' }, tab, runtime), true);
  assert.equal(trustedMessage({ type: 'data:delete' }, { id: 'unb', url: runtime.getURL('panel/panel.html') }, runtime), true);
  assert.equal(trustedMessage({}, { id: 'other', url: runtime.getURL('panel/panel.html') }, runtime), false);
});

test('content relay enforces the same API policy and GET-only transport', async () => {
  let handle;
  const calls = [];
  const script = await readFile(new URL('../unb-now/src/content/learn-bridge.js', import.meta.url), 'utf8');
  const policy = await readFile(new URL('../unb-now/src/data/unb.js', import.meta.url), 'utf8');
  assert.ok(script.includes(policy.split('export function lmsUrl')[0].replaceAll('export ', '')));
  vm.runInNewContext(script, {
    URL, AbortSignal, location: { origin: LMS_BASE, pathname: '/d2l/home' },
    chrome: { runtime: { id: 'unb', onMessage: { addListener: (fn) => { handle = fn; } }, sendMessage: async () => {} } },
    fetch: async (url, options) => { calls.push({ url, options }); return new Response('[]', { headers: { 'content-type': 'application/json' } }); }
  });
  assert.equal(handle({ type: 'live:fetch', path: '/d2l/api/versions/' }, { id: 'evil' }, () => {}), false);
  const result = await new Promise((resolve) => handle({ type: 'live:fetch', path: '/d2l/api/versions/' }, { id: 'unb' }, resolve));
  assert.equal(result.status, 200);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
});

test('packaged fork is UNB-only and retains attribution without telemetry', async () => {
  const root = new URL('../unb-now/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.deepEqual(manifest.host_permissions, [LMS_BASE + '/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, [LMS_BASE + '/*']);
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /Copyright \(c\) 2026 Eric Zou/);
  const files = await readdir(root, { recursive: true });
  for (const file of files.filter((p) => /\.(js|json|html)$/.test(p))) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /learn\.uwaterloo\.ca|cloud\.umami\.is|sleppyeric/, file);
  }
});

test('September cutoff includes Atlantic midnight and removes older saved and recovery items', async () => {
  const { COURSEWORK_CUTOFF, withinCourseworkWindow } = await import('../unb-now/src/data/cutoff.js');
  const { getState, setState } = await import('../unb-now/src/core/store.js');
  assert.equal(withinCourseworkWindow('2026-09-01T02:59:59.999Z'), false);
  assert.equal(withinCourseworkWindow(COURSEWORK_CUTOFF), true);
  assert.equal(withinCourseworkWindow('2026-09-01T00:00:00-03:00'), true);
  const old = { id: 'old', courseId: 'old-course', dueAt: '2026-08-31T23:59:00-03:00' };
  const current = { id: 'current', courseId: 'current-course', dueAt: COURSEWORK_CUTOFF, status: 'done' };
  const courses = [{ id: 'old-course', termKey: '2025-FA' }, { id: 'current-course', termKey: currentTerm().key }];
  let saved = { state: { termKey: currentTerm().key, items: [old, current], courses, carry: { items: [old, current] } } };
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: { get: async () => structuredClone(saved), set: async (value) => { saved = structuredClone(value); } } } };
  try {
    const state = await getState();
    assert.deepEqual(state.items, [current]);
    assert.deepEqual(state.courses, [courses[1]]);
    assert.deepEqual(state.carry.items, [current]);
    await setState({ ...state, items: [old, current], carry: [old, current] });
    assert.deepEqual(saved.state.items, [current]);
    assert.deepEqual(saved.state.carry, [current]);
  } finally { globalThis.chrome = previous; }
});

test('September cutoff bounds API windows and skips older tool, feed and calendar deadlines', async () => {
  const { COURSEWORK_CUTOFF } = await import('../unb-now/src/data/cutoff.js');
  const calls = [];
  const old = '2026-08-31T20:00:00Z';
  const source = sourceWith((url) => {
    calls.push(url);
    const p = url.pathname;
    if (p.endsWith('/versions/')) return [];
    if (p.includes('/myenrollments/')) return { Items: [enrollment(101)] };
    if (p.endsWith('/dropbox/folders/')) return [{ Id: 1, Name: 'Old assignment', DueDate: old }, { Id: 2, Name: 'New assignment', DueDate: COURSEWORK_CUTOFF }];
    if (p.includes('/mysubmissions/')) return [];
    if (p.endsWith('/quizzes/')) return [{ QuizId: 3, Name: 'Old quiz', EndDate: old }, { QuizId: 4, Name: 'New quiz', EndDate: COURSEWORK_CUTOFF }];
    if (p.endsWith('/discussions/forums/')) return [{ ForumId: 5 }];
    if (p.endsWith('/topics/')) return [{ TopicId: 6, Name: 'Old discussion', DueDate: old }, { TopicId: 7, Name: 'New discussion', DueDate: COURSEWORK_CUTOFF }];
    if (p.includes('/content/myItems/')) return { Objects: p.includes('/completions/') ? [] : [
      { OrgUnitId: 101, ItemId: 8, ItemName: 'Old content', DueDate: old, ActivityType: 1 },
      { OrgUnitId: 101, ItemId: 9, ItemName: 'New content', DueDate: COURSEWORK_CUTOFF, ActivityType: 1 }
    ] };
    if (p.includes('/calendar/events/')) return { Objects: [
      { CalendarEventId: 10, OrgUnitId: 101, Title: 'Old report due', EventType: 6, StartDateTime: old, IsAssociatedWithEntity: false },
      { CalendarEventId: 11, OrgUnitId: 101, Title: 'New report due', EventType: 6, StartDateTime: COURSEWORK_CUTOFF, IsAssociatedWithEntity: false }
    ] };
    throw new Error(`Unexpected request ${p}`);
  });
  const [course] = await source.listCourses();
  const items = await source.listDeadlines(course);
  assert.equal(items.length, 5);
  assert.ok(items.every((item) => item.title.startsWith('New')));
  assert.equal(calls.some((url) => url.pathname.includes('/folders/1/submissions/')), false);
  assert.equal(calls.some((url) => url.pathname.includes('/folders/2/submissions/')), true);
  const datedRequests = calls.filter((url) => url.searchParams.has('startDateTime') || url.searchParams.has('completedFromDateTime'));
  assert.ok(datedRequests.length >= 5);
  for (const url of datedRequests) assert.equal(url.searchParams.get('startDateTime') ?? url.searchParams.get('completedFromDateTime'), COURSEWORK_CUTOFF);
});
