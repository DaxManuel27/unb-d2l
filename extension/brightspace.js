import { activeAccount, reconcileScan, safeSourceUrl, validDate } from './core.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseBrightspaceDate(text, timeZone) {
  const match = text?.trim().match(/^(?:Due on |Available until |Ends )?([A-Z][a-z]{2}) (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) (AM|PM))?$/);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]) + 1;
  const day = `${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
  if (!validDate({ precision: 'date', value: day })) return null;
  if (!match[4]) return { precision: 'date', value: day };
  const hours = Number(match[4]);
  const minutes = Number(match[5]);
  if (!timeZone || hours < 1 || hours > 12 || minutes > 59) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch { return null; }
  const hour = hours % 12 + (match[6] === 'PM' ? 12 : 0);
  const wall = Date.UTC(Number(match[3]), month - 1, Number(match[2]), hour, minutes);
  const asParts = (timestamp) => Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter((entry) => entry.type !== 'literal').map((entry) => [entry.type, Number(entry.value)]));
  const candidates = new Set();
  for (const offset of [-36, -12, 0, 12, 36]) {
    const sample = wall + offset * 3600000;
    const parts = asParts(sample);
    const zoneOffset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - sample;
    const candidate = wall - zoneOffset;
    const check = asParts(candidate);
    if (check.year === Number(match[3]) && check.month === month && check.day === Number(match[2]) && check.hour === hour && check.minute === minutes) candidates.add(candidate);
  }
  if (candidates.size !== 1) return null;
  return { precision: 'time', resolution: 'minute', value: new Date([...candidates][0]).toISOString(), sourceZone: timeZone };
}

export function linkedIdentity(value, courseId) {
  const safe = safeSourceUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (/^\/d2l\/lms\/dropbox\/user\/(?:folder_submit_files|folders_history)\.d2l$/.test(url.pathname)
    && url.searchParams.get('ou') === courseId && /^\d+$/.test(url.searchParams.get('db') ?? '')) {
    return { identity: `assignment:${url.searchParams.get('db')}`, type: 'assignment' };
  }
  const content = url.pathname.match(/^\/d2l\/le\/content\/(\d+)\/viewContent\/(\d+)\/View$/);
  if (content && content[1] === courseId) return { identity: `content:${content[2]}`, type: 'other' };
  return null;
}

export function ingestPage(previous, packet, now = new Date().toISOString()) {
  if (packet?.status !== 'read') {
    const status = ['account-unknown','layout-unverified','unsupported'].includes(packet?.status) ? packet.status : 'failed';
    return { ...previous, scan: { ...previous.scan, status, attemptedAt: now } };
  }
  if (!/^\d+$/.test(packet.accountId) || !safeSourceUrl(packet.url) || !Array.isArray(packet.courses) || !Array.isArray(packet.rows)
    || packet.courses.length > 500 || packet.rows.length > 250) throw new Error('Invalid page snapshot');
  const known = previous.accounts.find((entry) => entry.id === packet.accountId);
  let timeZone = known?.timeZone ?? null;
  if (packet.pageType === 'settings' && packet.timeZone) {
    new Intl.DateTimeFormat('en', { timeZone: packet.timeZone }).format();
    timeZone = packet.timeZone;
  }
  const courses = packet.courses.filter((course) => /^\d+$/.test(course.id) && typeof course.name === 'string' && course.name.length <= 240);
  const ids = new Set([...courses, ...(known?.courses ?? [])].map((course) => course.id));
  const observations = [];
  let skipped = Number.isInteger(packet.skipped) ? packet.skipped : 0;
  for (const row of packet.rows) {
    if (!ids.has(row.courseId) || typeof row.title !== 'string' || !row.title.trim()) { skipped += 1; continue; }
    if (packet.pageType === 'assignments') {
      const linked = linkedIdentity(row.url, row.courseId);
      if (linked?.identity !== `assignment:${row.activityId}`) { skipped += 1; continue; }
      const due = row.dueText ? parseBrightspaceDate(row.dueText, timeZone) : null;
      if (row.dueText && !due) { skipped += 1; continue; }
      observations.push({
        sourceId: `assignment:${row.activityId}`, identity: linked.identity, courseId: row.courseId,
        title: row.title.slice(0,300), type: 'assignment', kind: 'deadline', source: 'activity', due,
        closes: parseBrightspaceDate(row.closeText, timeZone), submission: row.submission, url: row.url
      });
    } else if (packet.pageType === 'calendar-detail') {
      const identity = linkedIdentity(row.activityUrl, row.courseId);
      const epoch = Number(row.dueEpoch);
      const eventPath = new URL(packet.url).pathname;
      if (!/^\d+$/.test(row.eventId) || eventPath !== `/d2l/le/calendar/${row.courseId}/event/${row.eventId}/detailsview`
        || !identity || !/^\d{12,13}$/.test(row.dueEpoch) || !Number.isFinite(epoch)) { skipped += 1; continue; }
      observations.push({
        sourceId: `calendar:${row.eventId}`, identity: identity.identity, courseId: row.courseId, title: row.title.slice(0,300),
        type: identity.type, kind: 'deadline', source: 'calendar', due: { precision: 'time', value: new Date(epoch).toISOString() },
        closes: parseBrightspaceDate(row.closeText, timeZone), url: packet.url, submission: 'unknown'
      });
    }
  }
  const state = reconcileScan(previous, { status: 'success', accountId: packet.accountId, courses, observations, scopes: [], partial: true }, now);
  const account = activeAccount(state);
  account.timeZone = timeZone;
  const needsTimeZone = packet.pageType === 'assignments' && !timeZone;
  state.scan = {
    ...state.scan, status: needsTimeZone ? 'timezone-needed' : 'page-read', mode: 'open-page', pageType: packet.pageType,
    imported: observations.length, skipped, limited: Boolean(packet.limited), timeZone,
    notice: needsTimeZone ? 'Read your Brightspace Account Settings page first to verify the source timezone, then read this assignment list again.'
      : `Read ${observations.length} item${observations.length === 1 ? '' : 's'} from this open page. ${skipped ? `${skipped} rows could not be verified. ` : ''}This is not a complete course sync.`
  };
  return state;
}
