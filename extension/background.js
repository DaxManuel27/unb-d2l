import { initialState, applyAction, reminderPlan, formatDue, COLLECTION_ENABLED, safeSourceUrl } from './core.js';
import { readBrightspacePage } from './brightspace-reader.js';
import { ingestPage } from './brightspace.js';
import { HOME, LMS_ORIGINS, scanTargets, readScanPage } from './auto-scan.js';

let stepScheduled = false;
function continueScan() {
  if (stepScheduled) return;
  stepScheduled = true;
  exclusive(scanStep).catch(() => false).then((more) => {
    stepScheduled = false;
    if (more) continueScan();
  });
}

async function startScan(state) {
  if (!await chrome.permissions.contains({ origins: LMS_ORIGINS })) throw new Error('UNB access required');
  state.autoSync = { enabled: true, job: { pending: [HOME], visited: [], accountId: null, imported: 0, skipped: 0, failed: 0 } };
  state.scan = { ...state.scan, mode: 'automatic', status: 'scanning', failureCode: null, attemptedAt: new Date().toISOString(), notice: 'Scanning Brightspace in temporary background tabs. Your current tab will not change.' };
  await chrome.alarms.create('auto-scan', { periodInMinutes: 0.5 });
  await chrome.alarms.create('planner-maintenance', { periodInMinutes: 30 });
  await saveState(state);
  continueScan();
  return state;
}

async function scanStep() {
  let state = await readState();
  const job = state.autoSync?.job;
  if (!state.autoSync?.enabled || !job) return;
  if (!await chrome.permissions.contains({ origins: LMS_ORIGINS })) {
    state.autoSync = { enabled: false };
    state.scan = { ...state.scan, status: 'permission-needed', notice: 'Automatic scans paused: reconnect Brightspace to grant UNB-only access.' };
    await chrome.alarms.clear('auto-scan');
    await saveState(state);
    return;
  }
  const url = job.pending[0];
  try {
    const packet = await readScanPage(chrome, url, readBrightspacePage);
    if (!packet || packet.status === 'account-unknown' || packet.status === 'unsupported') throw new Error('Sign-in could not be verified.');
    if (job.accountId && packet.accountId !== job.accountId) throw new Error('Account changed during scanning.');
    if (packet.status === 'read') {
      job.accountId ??= packet.accountId;
      state = ingestPage(state, packet);
      job.imported += state.scan.imported ?? 0;
      job.skipped += state.scan.skipped ?? 0;
      const known = new Set([...job.pending, ...job.visited]);
      for (const target of scanTargets(packet)) if (!known.has(target)) { job.pending.push(target); known.add(target); }
    } else job.failed += 1;
    job.pending.shift();
    job.visited.push(url);
    const finished = !job.pending.length || job.visited.length >= 150;
    state.autoSync = { enabled: true, job: finished ? null : job };
    state.scan = { ...state.scan, mode: 'automatic', status: finished ? 'partial' : 'scanning',
      notice: `${finished ? 'Scan finished' : 'Scanning'}: ${job.visited.length} pages checked, ${job.imported} item observations, ${job.skipped} skipped rows, ${job.failed} unsupported layouts. ${finished ? 'Coverage is partial: only discovered courses, assignment lists and linked Calendar deadlines. Quizzes, Content, discussions and syllabi are not scanned.' : `${job.pending.length} pages remaining.`}` };
    await saveState(state);
    if (finished) await chrome.alarms.clear('auto-scan');
    return !finished;
  } catch (error) {
    state.autoSync = { enabled: true, job: null };
    state.scan = { ...state.scan, mode: 'automatic', status: 'account-unknown', failureCode: error.code ?? 'unverified',
      notice: error.code === 'page-error' ? 'Scanning paused: Brightspace returned an error page. This does not mean you are signed out. Reload the updated extension and reconnect to retry; cached records were kept.' : 'Scanning paused: the session or page could not be verified. Open Brightspace in this Chrome profile and reconnect. Cached records were kept.' };
    await saveState(state);
    await chrome.alarms.clear('auto-scan');
  }
}

let queue = Promise.resolve();
function exclusive(task) {
  const next = queue.then(task);
  queue = next.catch(() => {});
  return next;
}

async function readState() {
  const { planner } = await chrome.storage.local.get('planner');
  if (planner && planner.version !== 1) throw new Error('Saved data uses an unsupported version. It has not been changed.');
  return planner ?? initialState();
}

async function saveState(state) {
  await chrome.storage.local.set({ planner: state });
}

async function reconcileReminders(state) {
  await chrome.alarms.clear('next-reminder');
  if (!COLLECTION_ENABLED || !await chrome.permissions.contains({ permissions: ['notifications'] })) return;
  const plan = reminderPlan(state);
  for (const reminder of plan.due) {
    const notificationId = crypto.randomUUID();
    for (const key of reminder.keys) state.deliveries[key] = { at: Date.now(), notificationId, url: reminder.item.sources[0]?.url };
    await saveState(state);
    try {
      await chrome.notifications.create(notificationId, {
        type: 'basic', iconUrl: chrome.runtime.getURL('icon.png'),
        title: `${reminder.course.name}: ${reminder.item.title}`,
        message: `Due ${formatDue(reminder.item.due)}. Based on the last successful check.`
      });
    } catch {
      for (const key of reminder.keys) delete state.deliveries[key];
      await saveState(state);
    }
  }
  if (plan.next !== null) await chrome.alarms.create('next-reminder', { when: plan.next });
}

async function refresh(state) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !safeSourceUrl(tab.url)) {
    state.scan = { ...state.scan, attemptedAt: new Date().toISOString(), status: 'unsupported', notice: 'Open a supported Brightspace page and click the planner toolbar icon to grant temporary page access.' };
    await saveState(state);
    return state;
  }
  try {
    const [snapshot] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: readBrightspacePage });
    state = ingestPage(state, snapshot?.result);
  } catch {
    state.scan = { ...state.scan, attemptedAt: new Date().toISOString(), status: 'failed', notice: 'Could not read this page. Click the planner toolbar icon on Brightspace and retry. Cached records were kept.' };
  }
  await saveState(state);
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('index.html')) return false;
  exclusive(async () => {
    if (message?.type === 'clear') {
      await chrome.alarms.clearAll();
      if (await chrome.permissions.contains({ permissions: ['notifications'] })) {
        for (const id of Object.keys(await chrome.notifications.getAll())) await chrome.notifications.clear(id);
      }
      await chrome.storage.local.clear();
      return initialState();
    }
    let state = await readState();
    if (message?.type === 'connect') return startScan(state);
    if (message?.type === 'disconnect') {
      state.autoSync = { enabled: false };
      state.scan = { ...state.scan, status: 'paused', notice: 'Automatic scanning paused. Saved coursework is retained.' };
      await chrome.alarms.clear('auto-scan');
      await saveState(state);
      return state;
    }
    if (message?.type === 'action') {
      state = applyAction(state, message.action);
      await saveState(state);
      await reconcileReminders(state);
    } else if (message?.type === 'refresh') state = await refresh(state);
    else if (message?.type !== 'state') throw new Error('Unsupported operation');
    return state;
  }).then((state) => respond({ ok: true, state }), () => respond({ ok: false, error: 'The planner could not save or read local data. Existing records were kept.' }));
  return true;
});

async function setup() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  if (!await chrome.alarms.get('planner-maintenance')) {
    await chrome.alarms.create('planner-maintenance', { periodInMinutes: 30 });
  }
  const state = await readState();
  await reconcileReminders(state);
  if (state.autoSync?.enabled) {
    if (state.autoSync.job) {
      await chrome.alarms.create('auto-scan', { periodInMinutes: 0.5 });
      continueScan();
    } else await startScan(state);
  }
}

chrome.runtime.onInstalled.addListener(() => { exclusive(setup).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { exclusive(setup).catch(() => {}); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'auto-scan') { continueScan(); return; }
  if (!['next-reminder', 'planner-maintenance'].includes(alarm.name)) return;
  exclusive(async () => {
    const state = await readState();
    await reconcileReminders(state);
    if (alarm.name === 'planner-maintenance' && state.autoSync?.enabled && !state.autoSync.job) await startScan(state);
  }).catch(() => {});
});
chrome.notifications?.onClicked.addListener((id) => {
  exclusive(async () => {
    const state = await readState();
    const record = Object.values(state.deliveries).find((entry) => entry.notificationId === id);
    const url = safeSourceUrl(record?.url);
    if (url) await chrome.tabs.create({ url });
  }).catch(() => {});
});
exclusive(setup).catch(() => {});
