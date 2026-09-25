export const TYPES = ['assignment', 'test', 'quiz', 'exam', 'lab', 'discussion', 'other'];
export const COLORS = ['#3c65c5', '#8b4cb4', '#257463', '#b54b36', '#866411', '#ae4074'];
export const COLLECTION_ENABLED = false;

export function initialState() {
  return {
    version: 1,
    activeAccount: null,
    accounts: [],
    settings: {
      reminders: true,
      reminderTime: '08:00',
      leadMinutes: [],
      types: ['assignment', 'test', 'quiz', 'exam']
    },
    scan: { status: 'unverified', attemptedAt: null, succeededAt: null },
    deliveries: {}
  };
}

export function dateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function localDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function validDate(value) {
  if (value === null) return true;
  if (!value || typeof value.value !== 'string') return false;
  if (value.precision === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value.value) && dateKey(localDate(value.value)) === value.value;
  }
  return value.precision === 'time' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.value)
    && Number.isFinite(Date.parse(value.value))
    && validDate({ precision: 'date', value: value.value.slice(0, 10) });
}

export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://lms.unb.ca' && !url.username && !url.password
      && url.pathname.startsWith('/d2l/') ? url.href : null;
  } catch {
    return null;
  }
}

export function activeAccount(state) {
  return state.accounts.find((account) => account.id === state.activeAccount) ?? null;
}

export function completed(item) {
  return item.manualComplete || item.submission === 'submitted';
}

export function dueDay(due) {
  return due.precision === 'date' ? due.value : dateKey(new Date(due.value));
}

export function dueBoundary(due) {
  if (due.precision === 'time') return Date.parse(due.value);
  const next = localDate(due.value);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

export function formatDue(due) {
  if (!due) return 'No due date';
  const date = due.precision === 'date' ? localDate(due.value) : new Date(due.value);
  const label = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  return due.precision === 'date' ? `${label} · time not specified`
    : `${label} · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)}`;
}

export function visibleItems(state, { courseId = 'all', showCompleted = false } = {}) {
  if (state.scan.status === 'account-unknown') return [];
  const account = activeAccount(state);
  if (!account) return [];
  return account.items.filter((item) => {
    const course = account.courses.find((entry) => entry.id === item.courseId);
    return course?.visible && !item.archived && (courseId === 'all' || courseId === course.id)
      && (showCompleted || !completed(item));
  }).sort((left, right) => {
    const leftDate = left.due ?? left.eventDate;
    const rightDate = right.due ?? right.eventDate;
    return (leftDate ? dueBoundary(leftDate) : Infinity) - (rightDate ? dueBoundary(rightDate) : Infinity)
      || left.title.localeCompare(right.title);
  });
}

export function groupName(item, now = new Date()) {
  if (completed(item)) return 'Completed';
  if (!item.due) return 'No due date';
  if (dueBoundary(item.due) <= now.getTime()) return 'Overdue';
  if (dueDay(item.due) === dateKey(now)) return 'Today';
  const nextMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  nextMonday.setDate(nextMonday.getDate() + (7 - ((nextMonday.getDay() + 6) % 7)));
  const followingMonday = new Date(nextMonday);
  followingMonday.setDate(followingMonday.getDate() + 7);
  const day = dueDay(item.due);
  if (day < dateKey(nextMonday)) return 'This week';
  if (day < dateKey(followingMonday)) return 'Next week';
  return 'Later';
}

export function updateSettings(state, patch) {
  const settings = { ...state.settings, ...patch };
  if (typeof settings.reminders !== 'boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.reminderTime)
    || !Array.isArray(settings.leadMinutes) || settings.leadMinutes.length > 8
    || settings.leadMinutes.some((value) => !Number.isInteger(value) || value < 1 || value > 10080)
    || !Array.isArray(settings.types) || settings.types.some((value) => !TYPES.includes(value))) {
    throw new Error('Choose a valid time and reminder lead times from 1 to 10080 minutes.');
  }
  return { ...state, settings: {
    reminders: settings.reminders,
    reminderTime: settings.reminderTime,
    leadMinutes: [...new Set(settings.leadMinutes)].sort((left, right) => right - left),
    types: [...new Set(settings.types)]
  } };
}

export function reminderTimes(item, settings) {
  if (!item.due) return [];
  const due = item.due;
  const morning = localDate(dueDay(due));
  const [hours, minutes] = settings.reminderTime.split(':').map(Number);
  morning.setHours(hours, minutes, 0, 0);
  const timestamp = dueBoundary(due);
  const primary = due.precision === 'time' && morning.getTime() >= timestamp
    ? timestamp - 3600000 : morning.getTime();
  const times = [{ rule: 'day-of', at: primary }];
  if (due.precision === 'time') {
    for (const lead of settings.leadMinutes) times.push({ rule: `lead-${lead}`, at: timestamp - lead * 60000 });
  }
  return times;
}

export function reminderPlan(state, now = Date.now()) {
  const account = activeAccount(state);
  if (!account || !state.settings.reminders || state.scan.status === 'account-unknown') return { due: [], next: null };
  const due = [];
  let next = null;
  for (const item of visibleItems(state)) {
    const course = account.courses.find((entry) => entry.id === item.courseId);
    if (course.muted || item.kind !== 'deadline' || !item.due || !item.confirmed
      || !state.settings.types.includes(item.type) || dueBoundary(item.due) <= now) continue;
    const missed = [];
    for (const reminder of reminderTimes(item, state.settings)) {
      const deliveryDate = item.due.precision === 'time' ? `minute:${Math.floor(Date.parse(item.due.value) / 60000)}` : dateIdentity(item.due);
      const key = JSON.stringify([account.id, item.id, item.dueRevision ?? 0, deliveryDate, reminder.rule]);
      if (Object.hasOwn(state.deliveries, key)) continue;
      if (reminder.at <= now) missed.push(key);
      else next = next === null ? reminder.at : Math.min(next, reminder.at);
    }
    if (missed.length) due.push({ item, course, keys: missed });
  }
  return { due, next };
}

function validateScan(scan) {
  if (!scan || typeof scan.accountId !== 'string' || !scan.accountId || scan.accountId.length > 200
    || !Array.isArray(scan.courses) || !Array.isArray(scan.observations) || !Array.isArray(scan.scopes)) throw new Error('Invalid scan');
  for (const course of scan.courses) {
    if (typeof course.id !== 'string' || !course.id || typeof course.name !== 'string' || !course.name) throw new Error('Invalid course');
  }
  for (const claim of scan.observations) {
    if (typeof claim.sourceId !== 'string' || !claim.sourceId || typeof claim.courseId !== 'string'
      || typeof claim.identity !== 'string' || !claim.identity || typeof claim.title !== 'string' || !claim.title
      || !['activity', 'calendar'].includes(claim.source) || !TYPES.includes(claim.type)
      || !['deadline', 'event'].includes(claim.kind) || !safeSourceUrl(claim.url)
      || !validDate(claim.due) || !validDate(claim.eventDate ?? null) || !validDate(claim.closes ?? null)
      || !['submitted', 'absent', 'unknown'].includes(claim.submission ?? 'unknown')) throw new Error('Invalid source observation');
  }
}

function dateIdentity(date) {
  if (!date) return 'none';
  return date.precision === 'time' ? `time:${Date.parse(date.value)}` : `date:${date.value}`;
}

function sameDate(left, right) {
  if (!left || !right || left.precision !== right.precision) return dateIdentity(left) === dateIdentity(right);
  if (left.precision === 'time' && (left.resolution === 'minute' || right.resolution === 'minute')) {
    return Math.floor(Date.parse(left.value) / 60000) === Math.floor(Date.parse(right.value) / 60000);
  }
  return dateIdentity(left) === dateIdentity(right);
}

export function reconcileScan(previous, scan, now = new Date().toISOString()) {
  if (scan.status !== 'success') {
    return { ...previous, scan: { ...previous.scan, status: scan.status, attemptedAt: now } };
  }
  validateScan(scan);
  const state = structuredClone(previous);
  state.activeAccount = scan.accountId;
  let account = activeAccount(state);
  if (!account) {
    account = { id: scan.accountId, courses: [], items: [] };
    state.accounts.push(account);
  }
  for (const course of scan.courses) {
    const existing = account.courses.find((entry) => entry.id === course.id);
    if (existing) existing.name = course.name;
    else account.courses.push({ id: course.id, name: course.name, visible: course.current !== false, muted: false, color: COLORS[account.courses.length % COLORS.length] });
  }
  const seen = new Set();
  const affected = new Set();
  for (const observation of scan.observations) {
    if (!account.courses.some((course) => course.id === observation.courseId)) throw new Error('Unknown course');
    const identity = JSON.stringify([observation.courseId, observation.identity]);
    affected.add(identity);
    let item = account.items.find((entry) => entry.id === identity);
    if (!item) {
      item = {
        id: identity, courseId: observation.courseId, title: observation.title, type: observation.type,
        kind: observation.kind, due: null, eventDate: null, closes: null, confirmed: false,
        manualComplete: false, submission: 'unknown', submissionCheckedAt: null,
        sources: [], history: [], dueRevision: 0, firstSeen: now, archived: false
      };
      account.items.push(item);
    }
    const source = {
      id: observation.sourceId, source: observation.source, title: observation.title, type: observation.type,
      kind: observation.kind, due: observation.due, eventDate: observation.eventDate ?? null,
      closes: observation.closes ?? null, url: safeSourceUrl(observation.url), lastSeen: now, missing: 0
    };
    const index = item.sources.findIndex((entry) => entry.id === source.id);
    if (index >= 0) item.sources[index] = source;
    else item.sources.push(source);
    seen.add(JSON.stringify([identity, source.id]));
    if (observation.source === 'activity' && observation.type === 'assignment') {
      item.submissionUnknown = (observation.submission ?? 'unknown') === 'unknown';
      if (!item.submissionUnknown) {
        item.submission = observation.submission;
        item.submissionCheckedAt = now;
      }
    }
    item.lastSeen = now;
  }
  for (const item of account.items) {
    for (const source of item.sources) {
      const scope = scan.scopes.find((entry) => entry.courseId === item.courseId && entry.source === source.source && entry.complete === true);
      if (scope && !seen.has(JSON.stringify([item.id, source.id]))) {
        source.missing += 1;
        affected.add(item.id);
      }
    }
    if (!affected.has(item.id)) continue;
    const live = item.sources.filter((source) => source.missing < 2);
    item.archived = live.length === 0;
    item.notFound = live.some((source) => source.missing === 1);
    if (!live.length) continue;
    live.sort((left, right) => (left.source === 'activity' ? 0 : 1) - (right.source === 'activity' ? 0 : 1));
    const primary = live.find((source) => source.kind === 'deadline' && source.due) ?? live[0];
    const nextDue = primary.kind === 'deadline' ? primary.due : null;
    if (!sameDate(item.due, nextDue) && item.lastReconciled) {
      item.history.unshift({ previous: item.due, current: nextDue, at: now });
      item.dueRevision = (item.dueRevision ?? 0) + 1;
    }
    item.due = nextDue;
    item.kind = primary.kind;
    item.title = primary.title;
    item.type = primary.type;
    item.eventDate = primary.eventDate;
    item.closes = live.find((source) => source.closes)?.closes ?? null;
    item.confirmed = Boolean(nextDue);
    item.conflict = live.some((source) => source.kind === 'deadline' && source.due && nextDue && !sameDate(source.due, nextDue));
    item.lastReconciled = now;
  }
  state.scan = { status: scan.partial ? 'partial' : 'success', attemptedAt: now, succeededAt: now };
  return state;
}

export function applyAction(previous, action) {
  if (action.type === 'settings') return updateSettings(previous, action.patch);
  const state = structuredClone(previous);
  const account = activeAccount(state);
  if (!account) throw new Error('No active account');
  if (action.type === 'complete') {
    const item = account.items.find((entry) => entry.id === action.id);
    if (!item || typeof action.value !== 'boolean') throw new Error('Unknown item');
    item.manualComplete = action.value;
  } else if (action.type === 'course') {
    const course = account.courses.find((entry) => entry.id === action.id);
    if (!course) throw new Error('Unknown course');
    if (typeof action.visible === 'boolean') course.visible = action.visible;
    if (typeof action.muted === 'boolean') course.muted = action.muted;
    if (action.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(action.color)) throw new Error('Invalid color');
      course.color = action.color;
    }
  } else throw new Error('Unknown action');
  return state;
}
