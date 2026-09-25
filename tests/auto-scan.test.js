import assert from 'node:assert/strict';
import test from 'node:test';
import { HOME, SETTINGS, scanUrl, scanTargets, readScanPage } from '../extension/auto-scan.js';

test('automatic scan permits only verified read page routes', () => {
  for (const url of [HOME, `${SETTINGS}?ou=123`, `${HOME}/123`, 'https://lms.unb.ca/d2l/lms/dropbox/user/folders_list.d2l?ou=123&isprv=0', 'https://lms.unb.ca/d2l/le/calendar/123/event/456/detailsview']) assert.equal(scanUrl(url), url);
  for (const url of [SETTINGS, `${SETTINGS}?ou=123&ou=456`, `${SETTINGS}?ou=123&save=1`]) assert.equal(scanUrl(url), null);
  for (const url of ['https://evil.example/d2l/home', `${HOME}?delete=1`, 'https://user:pass@lms.unb.ca/d2l/home', 'https://lms.unb.ca/d2l/le/content/123/viewContent/456/View', 'https://lms.unb.ca/d2l/lms/dropbox/user/folder_submit_files.d2l?ou=123&db=456', 'https://lms.unb.ca/d2l/lms/quizzing/user/quiz_summary.d2l?qi=1', 'https://lms.unb.ca/d2l/lms/dropbox/user/folders_list.d2l?ou=123&ou=456']) assert.equal(scanUrl(url), null);
});

test('discovery deduplicates allowed observed links and ignores unsafe course ids', () => {
  assert.deepEqual(scanTargets({ courses: [{id:'123'}, {id:'../evil'}], links: [HOME, HOME, 'https://evil.example'] }), [`${HOME}/123`, HOME]);
});

test('scanner closes only its own inactive tab and never injects into redirects', async () => {
  const created = [], removed = [];
  let injected = 0;
  const api = {
    tabs: { create: async (options) => { created.push(options); return { id: 42 }; }, get: async () => ({ status: 'complete', url: 'https://login.example' }), remove: async (id) => removed.push(id) },
    scripting: { executeScript: async () => { injected += 1; return []; } }
  };
  await assert.rejects(readScanPage(api, HOME, () => {}, async () => {}), {code:'account-unknown'});
  assert.deepEqual(created, [{ url: HOME, active: false }]);
  assert.deepEqual(removed, [42]);
  assert.equal(injected, 0);
  await assert.rejects(readScanPage(api, 'https://evil.example', () => {}));
  assert.equal(created.length, 1);
});

test('observed settings URL retains required org unit and runs before course pages', () => {
  const settings = `${SETTINGS}?ou=123`;
  assert.deepEqual(scanTargets({courses:[{id:'456'}], links:[`${HOME}/456`, settings]}), [settings, `${HOME}/456`]);
});

test('Brightspace bad requests are identified separately from sign-in redirects', async () => {
  const api = {
    tabs: { create: async () => ({id:42}), get: async () => ({status:'complete', url:'https://lms.unb.ca/d2l/error/400'}), remove: async () => {} },
    scripting: { executeScript: async () => { throw new Error('Must not inject'); } }
  };
  await assert.rejects(readScanPage(api, `${SETTINGS}?ou=123`, () => {}, async () => {}), {code:'page-error'});
});

test('scanner retries delayed course cards and closes its tab after reading', async () => {
  let attempts = 0;
  const removed = [];
  const api = {
    tabs: { create: async () => ({id: 42}), get: async () => ({status:'complete', url:HOME}), remove: async (id) => removed.push(id) },
    scripting: { executeScript: async () => [{result:{status:'read', pageType:'home', courses: ++attempts === 2 ? [{id:'123'}] : []}}] }
  };
  const result = await readScanPage(api, HOME, () => {}, async () => {});
  assert.equal(result.courses.length, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(removed, [42]);
});
