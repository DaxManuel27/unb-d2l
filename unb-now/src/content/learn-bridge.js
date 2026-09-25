// UNB same-origin API relay. GET only; never navigates or modifies an LMS page.
(() => {
// Institution-specific policy for the WATnow-derived UNB build.
const LMS_BASE = 'https://lms.unb.ca';

function apiPath(value) {
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


  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || msg?.type !== 'live:fetch') return false;
    const path = apiPath(msg.path);
    if (!path || location.origin !== LMS_BASE) { respond({ status: 0, error: 'path not allowed' }); return false; }
    (async () => {
      try {
        const res = await fetch(LMS_BASE + path, { method: 'GET', credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        const type = res.headers.get('content-type') || '';
        const loginRedirect = res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400);
        const out = { status: res.status, type, loginRedirect };
        if (res.ok && type.includes('json')) out.json = await res.json();
        respond(out);
      } catch { respond({ status: 0, error: 'UNB request failed' }); }
    })();
    return true;
  });
  chrome.runtime.sendMessage({ type: 'live:learn-page', login: /^\/d2l\/login/i.test(location.pathname) }).catch(() => {});
})();
