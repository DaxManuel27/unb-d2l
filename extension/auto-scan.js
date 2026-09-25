export const LMS_ORIGINS = ['https://lms.unb.ca/*'];
export const HOME = 'https://lms.unb.ca/d2l/home';
export const SETTINGS = 'https://lms.unb.ca/d2l/lp/preferences/preferences_main/preferences_main.d2l';

export function scanUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== 'https://lms.unb.ca' || url.username || url.password || url.hash) return null;
  const keys = [...url.searchParams.keys()];
  if (/^\/d2l\/home(?:\/\d+)?\/?$/.test(url.pathname) && !keys.length) return url.href;
  if (url.pathname === new URL(SETTINGS).pathname && keys.length === 1 && keys[0] === 'ou'
    && /^\d+$/.test(url.searchParams.get('ou') ?? '')) return url.href;
  if (/^\/d2l\/le\/calendar\/\d+\/event\/\d+\/detailsview$/.test(url.pathname) && !keys.length) return url.href;
  if (url.pathname === '/d2l/lms/dropbox/user/folders_list.d2l'
    && /^\d+$/.test(url.searchParams.get('ou') ?? '')
    && keys.every((key) => ['ou', 'isprv'].includes(key)) && keys.length === new Set(keys).size
    && (!url.searchParams.has('isprv') || url.searchParams.get('isprv') === '0')) return url.href;
  return null;
}

export function scanTargets(packet) {
  return [...new Set([
    ...(packet.links ?? []).filter((value) => scanUrl(value) && new URL(value).pathname === new URL(SETTINGS).pathname),
    ...(packet.courses ?? []).filter((course) => /^\d+$/.test(course.id)).map((course) => `${HOME}/${course.id}`),
    ...(packet.links ?? [])
  ].map(scanUrl).filter(Boolean))];
}

export async function readScanPage(api, url, reader, pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {
  if (!scanUrl(url)) throw new Error('Unsupported scan target');
  const tab = await api.tabs.create({ url, active: false });
  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await pause(1000);
      const current = await api.tabs.get(tab.id);
      if (current.status !== 'complete') continue;
      if (!scanUrl(current.url)) {
        const error = new Error('The scan page redirected to an unsupported destination.');
        error.code = current.url?.startsWith('https://lms.unb.ca/d2l/error/') ? 'page-error' : 'account-unknown';
        throw error;
      }
      const [snapshot] = await api.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: reader });
      const packet = snapshot?.result;
      if (packet?.status === 'account-unknown' || (packet?.pageType === 'home' && !packet.courses?.length)) continue;
      return packet;
    }
    throw new Error('Page did not become ready. Cached coursework was kept.');
  } finally {
    await api.tabs.remove(tab.id).catch(() => {});
  }
}
