// Institution-specific policy for the WATnow-derived UNB build.
export const LMS_BASE = 'https://lms.unb.ca';

export function apiPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/d2l/api/') || /[\\#]/.test(value)) return null;
  let decoded;
  try { decoded = decodeURIComponent(value.split('?')[0]); } catch { return null; }
  if (decoded !== value.split('?')[0] || decoded.split('/').some((part) => part === '.' || part === '..')) return null;
  const url = new URL(value, LMS_BASE);
  const routes = [
    /^\/d2l\/api\/versions\/$/,
    /^\/d2l\/api\/lp\/\d+\.\d+\/users\/whoami\/?$/,
    /^\/d2l\/api\/lp\/\d+\.\d+\/enrollments\/myenrollments\/$/,
    /^\/d2l\/api\/lp\/\d+\.\d+\/enrollments\/myenrollments\/\d+\/parentOrgUnits\/?$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/(?:\d+\/)?calendar\/events\/myEvents\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/content\/myItems\/(?:due\/|completions\/(?:due\/)?)?$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/\d+\/dropbox\/(?:categories\/|folders\/(?:\d+\/submissions\/mysubmissions\/)?)$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/\d+\/quizzes\/$/,
    /^\/d2l\/api\/le\/\d+\.\d+\/\d+\/discussions\/forums\/(?:\d+\/topics\/)?$/,
  ];
  return url.origin === LMS_BASE && routes.some((route) => route.test(url.pathname)) ? url.pathname + url.search : null;
}

export function lmsUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === LMS_BASE && !url.username && !url.password && url.pathname.startsWith('/d2l/') ? url.href : null;
  } catch { return null; }
}

// Availability is checked separately from semester membership in live-source.js.
export function accessibleEnrollments(rows, now) {
  return rows.filter((row) => {
    const unit = row?.OrgUnit;
    const access = row?.Access ?? {};
    if (!/^\d+$/.test(String(unit?.Id ?? '')) || Number(unit.Id) <= 0) return false;
    if (unit.Type?.Id != null && Number(unit.Type.Id) !== 3) return false;
    if (access.CanAccess === false || access.IsActive === false) return false;
    const start = Date.parse(access.StartDate ?? '');
    const end = Date.parse(access.EndDate ?? '');
    const grace = 14 * 86400000;
    return (!Number.isFinite(start) || start <= now + grace) && (!Number.isFinite(end) || end >= now - grace);
  });
}

export function trustedMessage(message, sender, runtime) {
  if (sender?.id !== runtime.id) return false;
  if (message?.type === 'live:learn-page') return Boolean(sender.tab && lmsUrl(sender.url));
  return ['panel/panel.html', 'options/options.html'].some((page) => sender.url?.split(/[?#]/)[0] === runtime.getURL(page));
}
