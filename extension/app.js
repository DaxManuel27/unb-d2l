import { activeAccount, applyAction, completed, dateKey, dueDay, formatDue, groupName, initialState, localDate, safeSourceUrl, TYPES, visibleItems } from './core.js';
import { demoState } from './demo.js';
import { LMS_ORIGINS } from './auto-scan.js';

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const query = (selector) => document.querySelector(selector);
const isExtension = Boolean(globalThis.chrome?.runtime?.id);
let saved = initialState();
let preview = null;
let view = 'todo';
let selectedCourse = 'all';
let showCompleted = false;
let groupByCourse = false;
let cursor = new Date();
let selectedDay = dateKey();
let busy = false;

function state() { return preview ?? saved; }
function button(text, handler, className = '') {
  const control = element('button', text, className);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
}
function announce(text) {
  query('#message').textContent = text;
  query('#message').hidden = false;
}
async function connectBrightspace() {
  try {
    if (!await chrome.permissions.request({ origins: LMS_ORIGINS })) { announce('UNB access was not granted. No automatic scan started.'); return; }
    saved = await request({ type: 'connect' });
    render();
  } catch (error) { announce(error.message); }
}
function checkbox(label, checked, handler, id) {
  const wrapper = element('label', undefined, 'check-label');
  const input = element('input');
  input.type = 'checkbox';
  input.checked = checked;
  if (id) input.id = id;
  input.addEventListener('change', () => handler(input.checked));
  wrapper.append(input, element('span', label));
  return wrapper;
}
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? 'The local planner is unavailable. Reopen the side panel.');
  return response.state;
}
async function change(action) {
  if (busy) return;
  busy = true;
  try {
    if (preview) preview = applyAction(preview, action);
    else if (isExtension) saved = await request({ type: 'action', action });
    else saved = applyAction(saved, action);
    render();
  } catch (error) { announce(error.message); }
  finally { busy = false; }
}
function items() { return visibleItems(state(), { courseId: selectedCourse, showCompleted }); }
function courseFor(item) { return activeAccount(state())?.courses.find((course) => course.id === item.courseId); }
function dot(color) {
  const swatch = element('span', undefined, 'swatch');
  swatch.style.setProperty('--course-color', /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : '#3c65c5');
  swatch.setAttribute('aria-hidden', 'true');
  return swatch;
}
function filters() {
  const container = element('div', undefined, 'filters');
  const select = element('select');
  select.id = 'course-filter';
  select.setAttribute('aria-label', 'Filter by course');
  const all = element('option', 'All visible courses');
  all.value = 'all';
  select.append(all);
  for (const course of activeAccount(state())?.courses ?? []) {
    if (!course.visible) continue;
    const option = element('option', course.name);
    option.value = course.id;
    select.append(option);
  }
  select.value = selectedCourse;
  if (!select.value) { selectedCourse = 'all'; select.value = 'all'; }
  select.addEventListener('change', () => { selectedCourse = select.value; render(); });
  container.append(select, checkbox('Completed', showCompleted, (value) => { showCompleted = value; render(); }, 'show-completed'));
  return container;
}
function heading(title, description) {
  const wrapper = element('div', undefined, 'page-heading');
  const content = element('div');
  content.append(element('p', new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()), 'eyebrow'), element('h1', title));
  if (description) content.append(element('p', description, 'subtitle'));
  wrapper.append(content);
  return wrapper;
}
function list(records) {
  const container = element('ul', undefined, 'item-list');
  for (const item of records) {
    const row = element('li', undefined, `item${completed(item) ? ' completed' : ''}`);
    const completion = element('label', undefined, 'completion');
    const check = element('input');
    check.type = 'checkbox';
    check.checked = completed(item);
    check.disabled = item.submission === 'submitted';
    check.setAttribute('aria-label', item.submission === 'submitted' ? `${item.title}: submitted in D2L` : `Check off ${item.title}`);
    check.id = `check-${encodeURIComponent(item.id)}`;
    check.addEventListener('change', () => change({ type: 'complete', id: item.id, value: check.checked }));
    completion.append(check);
    const open = button('', () => openDetail(item), 'item-open');
    open.id = `item-${encodeURIComponent(item.id)}`;
    const course = courseFor(item);
    const label = element('span', undefined, 'course-label');
    label.append(dot(course?.color), element('span', course?.name ?? 'Course'));
    open.append(label, element('span', item.title, 'item-title'), element('span', formatDue(item.due ?? item.eventDate), 'item-date'));
    if (item.kind === 'event') open.append(element('span', 'Event · not a deadline', 'badge'));
    if (item.conflict) open.append(element('span', 'Date conflict', 'badge warning'));
    if (item.history.length) open.append(element('span', 'Updated', 'badge'));
    if (item.notFound) open.append(element('span', 'Not found on latest scan', 'badge warning'));
    if (completed(item)) open.append(element('span', item.submission === 'submitted' ? 'Submitted in D2L' : 'Checked off by you', 'item-date'));
    row.append(completion, open);
    container.append(row);
  }
  return container;
}
function empty(title, description) {
  const wrapper = element('div', undefined, 'empty');
  wrapper.append(element('h2', title), element('p', description));
  return wrapper;
}
function welcome(main) {
  const panel = element('section', undefined, 'welcome');
  const icon = element('img', undefined, 'illustration');
  icon.src = 'icon.svg'; icon.alt = ''; icon.width = 56; icon.height = 56;
  panel.append(icon, element('h2', 'A little more room to focus.'), element('p', 'Keep your coursework in one quiet place. See what’s next, plan your week, and check things off without changing Brightspace.'));
  const actions = element('div', undefined, 'actions');
  const login = element('a', 'Open Brightspace');
  login.href = 'https://lms.unb.ca'; login.target = '_blank'; login.rel = 'noopener noreferrer';
  if (!isExtension) actions.append(button('Explore fictional demo', () => { preview = demoState(); selectedCourse = 'all'; render(); }, 'primary'));
  else actions.append(button('Connect Brightspace', connectBrightspace, 'primary'));
  actions.append(login);
  panel.append(actions);
  main.append(panel);
  const notice = element('div', undefined, 'notice');
  notice.append(element('strong', 'Connect once, scan automatically'), element('p', 'Sign in to UNB Brightspace, then connect here. Allow access to lms.unb.ca only. The planner checks supported pages in temporary background tabs every 30 minutes while Chrome is running. It does not open submissions, Content, discussions, or quiz attempts. Coverage is partial; syllabi remain excluded.'));
  main.append(notice);
}
function todo(main) {
  const deadlines = items().filter((item) => item.kind === 'deadline');
  const todayCount = deadlines.filter((item) => groupName(item) === 'Today').length;
  main.append(heading(preview ? 'Fictional demo coursework' : 'Your coursework', preview ? 'Sample assignments only — not your Brightspace data.' : todayCount ? `${todayCount} ${todayCount === 1 ? 'deadline' : 'deadlines'} today. One thing at a time.` : 'A clear view of what’s coming next.'));
  if (!activeAccount(state())) { welcome(main); return; }
  main.append(filters(), checkbox('Group by course', groupByCourse, (value) => { groupByCourse = value; render(); }, 'group-course'));
  if (!deadlines.length) main.append(empty('Nothing on your list', 'No deadlines match these filters. Completed work is available above.'));
  const groups = groupByCourse ? (activeAccount(state())?.courses ?? []).map((course) => [course.name, deadlines.filter((item) => item.courseId === course.id)])
    : ['Overdue', 'Today', 'This week', 'Next week', 'Later', 'No due date', 'Completed'].map((name) => [name, deadlines.filter((item) => groupName(item) === name)]);
  for (const [name, records] of groups) {
    if (!records.length) continue;
    const section = element('section', undefined, `group${name === 'Overdue' ? ' overdue' : ''}`);
    const title = element('h2', name, 'group-title');
    title.append(element('span', String(records.length)));
    section.append(title, list(records)); main.append(section);
  }
}
function navigation(mode) {
  const bar = element('div', undefined, 'date-navigation');
  const label = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
  bar.append(element('strong', label));
  const move = (direction) => {
    if (mode === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
    else cursor.setDate(cursor.getDate() + direction * 7);
    render();
  };
  const previous = button('‹', () => move(-1)); previous.setAttribute('aria-label', `Previous ${mode}`);
  const next = button('›', () => move(1)); next.setAttribute('aria-label', `Next ${mode}`);
  bar.append(previous, button('Today', () => { cursor = new Date(); selectedDay = dateKey(); render(); }), next);
  return bar;
}
function onDay(day) { return items().filter((item) => (item.due || item.eventDate) && dueDay(item.due ?? item.eventDate) === day); }
function week(main) {
  main.append(heading('A week at a glance', 'Deadlines and events, with space to plan.'), filters(), navigation('week'));
  const monday = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(monday); date.setDate(date.getDate() + offset);
    const section = element('section', undefined, 'group');
    const title = element('h2', new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(date), 'group-title');
    if (dateKey(date) === dateKey()) title.append(element('span', 'Today'));
    const records = onDay(dateKey(date));
    section.append(title, records.length ? list(records) : element('p', 'No deadlines or events', 'muted'));
    main.append(section);
  }
}
function month(main) {
  main.append(heading('The bigger picture', 'Select a day to see its coursework.'), filters(), navigation('month'));
  const calendar = element('div', undefined, 'calendar');
  for (const name of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) calendar.append(element('div', name, 'weekday'));
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  for (let offset = 0; offset < 42; offset += 1) {
    const date = new Date(start); date.setDate(date.getDate() + offset);
    const key = dateKey(date);
    const records = onDay(key);
    const day = button(String(date.getDate()), () => { selectedDay = key; render(); }, 'day');
    day.id = `day-${key}`;
    day.classList.toggle('outside', date.getMonth() !== cursor.getMonth());
    day.classList.toggle('today', key === dateKey());
    day.classList.toggle('selected', key === selectedDay);
    day.setAttribute('aria-pressed', String(key === selectedDay));
    day.setAttribute('aria-label', `${new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)}: ${records.length} items`);
    const dots = element('span', undefined, 'day-dots');
    for (const item of records.slice(0, 3)) dots.append(dot(courseFor(item)?.color));
    if (records.length > 3) dots.append(element('span', '+'));
    day.append(dots); calendar.append(day);
  }
  main.append(calendar);
  const selected = element('section', undefined, 'selected-day');
  selected.append(element('h2', new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(localDate(selectedDay)), 'group-title'));
  const records = onDay(selectedDay);
  selected.append(records.length ? list(records) : element('p', 'No deadlines or events on this day.', 'muted'));
  main.append(selected);
}
function settings(main) {
  main.append(heading('Make it yours', 'Quiet reminders. Your courses. Your data.'));
  const reminders = element('section', undefined, 'settings-section');
  reminders.append(element('h2', 'Reminders'), checkbox('Enable reminders', state().settings.reminders, (value) => change({ type: 'settings', patch: { reminders: value } }), 'reminder-enabled'));
  const timeField = element('label', undefined, 'field');
  timeField.append(element('span', 'Day-of reminder time · local'));
  const clock = element('input'); clock.type = 'time'; clock.value = state().settings.reminderTime; clock.id = 'reminder-time'; clock.required = true;
  clock.addEventListener('change', () => change({ type: 'settings', patch: { reminderTime: clock.value } }));
  timeField.append(clock);
  reminders.append(timeField, element('p', 'Earlier deadlines get a reminder one hour before due. After sleep, only upcoming deadlines get one catch-up reminder.', 'muted'));
  const types = element('div', undefined, 'type-grid');
  for (const type of TYPES) {
    types.append(checkbox(type[0].toUpperCase() + type.slice(1), state().settings.types.includes(type), (checked) => {
      const chosen = state().settings.types.filter((entry) => entry !== type);
      if (checked) chosen.push(type);
      change({ type: 'settings', patch: { types: chosen } });
    }, `type-${type}`));
  }
  reminders.append(types);
  const leadField = element('label', undefined, 'field');
  leadField.append(element('span', 'Extra lead times in minutes (optional)'));
  const leads = element('input'); leads.type = 'text'; leads.placeholder = 'For example: 60, 1440'; leads.value = state().settings.leadMinutes.join(', '); leads.id = 'lead-times';
  leadField.append(leads, element('small', 'Comma-separated, up to 8 values. Timed deadlines only.'));
  reminders.append(leadField, button('Save lead times', () => {
    const values = leads.value.trim() ? leads.value.split(',').map((value) => Number(value.trim())) : [];
    change({ type: 'settings', patch: { leadMinutes: values } });
  }));
  reminders.append(element('div', 'Notification delivery is disabled until read-only course collection is validated. Preview mode never sends notifications.', 'notice'));
  main.append(reminders);
  const courses = element('section', undefined, 'settings-section');
  courses.append(element('h2', 'Courses'), element('p', 'Hidden courses leave all views and stop reminders. Cached records are retained.', 'muted'));
  for (const course of activeAccount(state())?.courses ?? []) {
    const row = element('div', undefined, 'course-setting');
    row.append(element('strong', course.name));
    const options = element('div', undefined, 'course-options');
    const color = element('input'); color.type = 'color'; color.value = course.color; color.id = `color-${course.id}`; color.setAttribute('aria-label', `Color for ${course.name}`);
    color.addEventListener('change', () => change({ type: 'course', id: course.id, color: color.value }));
    options.append(checkbox('Show', course.visible, (value) => change({ type: 'course', id: course.id, visible: value }), `visible-${course.id}`), checkbox('Mute reminders', course.muted, (value) => change({ type: 'course', id: course.id, muted: value }), `mute-${course.id}`), color);
    row.append(options); courses.append(row);
  }
  if (!activeAccount(state())?.courses.length) courses.append(element('p', 'Your courses will appear after the connection is verified.', 'subtitle'));
  main.append(courses);
  const status = element('section', undefined, 'settings-section');
  status.append(element('h2', 'Connection'), element('p', preview ? 'Preview data only' : state().scan.mode === 'automatic' ? 'Automatic scanning · partial coverage' : state().scan.mode === 'open-page' ? 'Manual page reading · partial coverage' : 'No Brightspace page read yet', 'muted'));
  status.append(element('p', `Last check attempted: ${state().scan.attemptedAt ? new Date(state().scan.attemptedAt).toLocaleString() : 'Never'}`, 'subtitle'));
  status.append(element('p', `Last successful page read: ${state().scan.succeededAt ? new Date(state().scan.succeededAt).toLocaleString() : 'Never'}`, 'subtitle'));
  if (state().scan.timeZone) status.append(element('p', `Verified Brightspace timezone: ${state().scan.timeZone}`, 'subtitle'));
  status.append(element('p', state().autoSync?.enabled ? 'Automatic scans enabled · every 30 minutes while Chrome is running. Only supported, discovered pages are scanned.' : 'Automatic scans are off.', 'subtitle'));
  if (isExtension && !preview) {
    status.append(button(state().autoSync?.enabled ? 'Scan now' : 'Connect Brightspace', connectBrightspace));
    if (state().autoSync?.enabled) status.append(button('Pause automatic scans', async () => {
      try { saved = await request({ type: 'disconnect' }); render(); }
      catch (error) { announce(error.message); }
    }));
  }
  main.append(status);
  const privacy = element('section', undefined, 'settings-section');
  privacy.append(element('h2', 'Private by design'), element('p', 'Planner data stays in this Chrome profile. No developer server, cloud sync, analytics, or stored login credentials. Check-offs never change D2L.', 'muted'));
  privacy.append(element('p', preview ? 'This preview is held in memory and discarded when you leave it.' : 'Clearing data also cancels scheduled reminders.', 'subtitle'));
  privacy.append(button('Clear saved data…', () => query('#clear-dialog').showModal(), 'quiet'));
  main.append(privacy);
}
function openDetail(item) {
  const body = query('#detail-content'); body.replaceChildren();
  const title = element('h2', item.title); title.id = 'detail-title'; title.tabIndex = -1;
  body.append(element('p', courseFor(item)?.name ?? 'Course', 'eyebrow'), title);
  const facts = element('dl');
  const fact = (name, value) => facts.append(element('dt', name), element('dd', value));
  fact(item.kind === 'event' ? 'Event date' : 'Due', formatDue(item.due ?? item.eventDate));
  fact('Activity type', item.type);
  if (item.closes) fact('Closing / availability end', formatDue(item.closes));
  fact('Completion', item.submission === 'submitted' ? 'Submitted in D2L' : item.manualComplete ? 'Checked off by you' : 'Not checked off');
  if (item.type === 'assignment') fact('D2L submission status', item.submission === 'unknown' ? 'Unknown' : item.submissionUnknown ? `Unknown on latest check; last verified status: ${item.submission}` : item.submission);
  fact('Last checked', new Date(item.lastReconciled).toLocaleString());
  body.append(facts);
  if (item.conflict) body.append(element('p', 'Date conflict: the explicit activity due date takes priority over the linked Calendar date.', 'notice'));
  if (item.history.length) {
    body.append(element('h3', 'Date changes'));
    for (const entry of item.history) {
      const line = element('p');
      line.append(element('s', formatDue(entry.previous)), element('span', ` → ${formatDue(entry.current)}`));
      body.append(line);
    }
  }
  body.append(element('h3', 'Sources'));
  for (const source of item.sources) {
    const section = element('div', undefined, 'source');
    section.append(element('strong', source.source === 'activity' ? 'D2L activity' : 'D2L Calendar'), element('p', formatDue(source.due ?? source.eventDate)));
    if (source.missing) section.append(element('p', 'Not found on latest successful source scan', 'muted'));
    const url = safeSourceUrl(source.url);
    if (url && !preview) {
      const link = element('a', 'Open source in Brightspace'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link);
    } else if (preview) section.append(element('p', 'Fictional preview item · no real source', 'muted'));
    body.append(section);
  }
  query('#detail').showModal();
  title.focus({ preventScroll: true });
  query('#detail').scrollTop = 0;
}
function render() {
  const focused = document.activeElement?.id;
  if (selectedCourse !== 'all' && !activeAccount(state())?.courses.some((course) => course.id === selectedCourse && course.visible)) selectedCourse = 'all';
  query('#demo-banner').hidden = !preview;
  for (const tab of document.querySelectorAll('[data-view]')) {
    if (tab.dataset.view === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  const main = query('#main'); main.replaceChildren();
  if (!preview && activeAccount(state())) {
    const connection = element('div', undefined, 'notice');
    connection.append(element('strong', state().scan.mode === 'automatic' ? 'Automatic scanning · partial coverage' : 'Partial coverage · open pages only'), element('p', state().scan.notice ?? 'Connect Brightspace to scan supported pages automatically.'));
    main.append(connection);
  }
  if (!preview && state().scan.status === 'account-unknown') {
    main.append(empty(state().scan.failureCode === 'page-error' ? 'Brightspace page could not be loaded' : 'Account could not be verified', 'Cached coursework is hidden until a supported page identifies the signed-in account.'));
    if (state().scan.notice && !activeAccount(state())) main.append(element('p', state().scan.notice, 'notice'));
    if (isExtension) main.append(button('Reconnect Brightspace', connectBrightspace, 'primary'));
    return;
  }
  ({ todo, week, month, settings })[view](main);
  if (focused) (document.getElementById(focused) ?? query('#show-completed') ?? main).focus({ preventScroll: true });
}
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => { view = tab.dataset.view; render(); });
query('#leave-demo').addEventListener('click', () => { preview = null; selectedCourse = 'all'; showCompleted = false; query('#detail').close(); render(); });
query('#close-detail').addEventListener('click', () => query('#detail').close());
query('#cancel-clear').addEventListener('click', () => query('#clear-dialog').close());
query('#confirm-clear').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  try {
    if (preview) preview = initialState();
    else saved = isExtension ? await request({ type: 'clear' }) : initialState();
    selectedCourse = 'all';
    query('#clear-dialog').close(); render(); announce(preview ? 'Preview data cleared.' : 'Saved data and reminder history cleared.');
  } catch (error) { announce(error.message); }
  finally { busy = false; }
});
query('#refresh').addEventListener('click', async () => {
  if (preview) { announce('Preview data is fictional and does not sync with Brightspace.'); return; }
  query('#refresh').disabled = true;
  try {
    if (isExtension) saved = await request({ type: 'refresh' });
    render(); announce(isExtension ? saved.scan.notice ?? `Page read status: ${saved.scan.status}. Only the already-loaded page was inspected.` : 'Page reading is available in the installed Chrome extension. This web preview cannot access Brightspace.');
  } catch (error) { announce(error.message); }
  finally { query('#refresh').disabled = false; }
});
if (isExtension) {
  try { saved = await request({ type: 'state' }); }
  catch (error) { announce(error.message); }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.planner) {
      saved = changes.planner.newValue ?? initialState();
      if (!preview) { query('#detail').close(); render(); }
    }
  });
}
render();
