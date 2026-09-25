export function readBrightspacePage() {
  if (location.origin !== 'https://lms.unb.ca') return { status: 'unsupported' };
  const page = new URL(location.href);
  let pageType;
  if (/^\/d2l\/home(?:\/\d+)?\/?$/.test(page.pathname)) pageType = 'home';
  else if (page.pathname === '/d2l/lms/dropbox/user/folders_list.d2l') pageType = 'assignments';
  else if (/^\/d2l\/le\/calendar\/\d+\/event\/\d+\/detailsview\/?$/.test(page.pathname)) pageType = 'calendar-detail';
  else if (page.pathname === '/d2l/lp/preferences/preferences_main/preferences_main.d2l') pageType = 'settings';
  else return { status: 'unsupported' };

  const navigation = document.querySelector('.d2l-navigation-s-personal-menu');
  const progress = [...(navigation?.querySelectorAll('a[href]') ?? [])].map((link) => {
    try { return new URL(link.getAttribute('href'), page.origin); } catch { return null; }
  }).filter((url) => url?.origin === page.origin && /^\/d2l\/le\/userprogress\/\d+\/\d+\/Summary$/.test(url.pathname));
  const accounts = [...new Set(progress.map((url) => url.pathname.split('/')[4]))];
  if (accounts.length !== 1) return { status: 'account-unknown' };
  const accountId = accounts[0];
  const courses = new Map();
  const roots = [document];
  let inspected = 0;
  let limited = false;
  for (let index = 0; index < roots.length; index += 1) {
    for (const node of roots[index].querySelectorAll('*')) {
      if (++inspected > 20000) { limited = true; break; }
      if (node.shadowRoot) roots.push(node.shadowRoot);
      if (node.tagName !== 'A') continue;
      let target;
      try { target = new URL(node.getAttribute('href'), page.href); } catch { continue; }
      if (target.origin !== page.origin) continue;
      const match = target.pathname.match(/^\/d2l\/home\/(\d+)\/?$/);
      if (!match) continue;
      const name = (node.innerText || node.getAttribute('aria-label') || node.textContent || '').trim().split(/\n/)[0].slice(0,240);
      if (!name || /^(?:Course Home|My Home)$/i.test(name)) continue;
      if (!courses.has(match[1])) courses.set(match[1], { id: match[1], name });
    }
    if (limited) break;
  }

  const links = [...document.querySelectorAll('a[href]')].map((node) => {
    try {
      const target = new URL(node.getAttribute('href'), page.href);
      if (target.origin !== page.origin || target.username || target.password) return null;
      if (/^\/d2l\/home\/\d+\/?$/.test(target.pathname)
        || /^\/d2l\/le\/calendar\/\d+\/event\/\d+\/detailsview$/.test(target.pathname)
        || target.pathname === '/d2l/lms/dropbox/user/folders_list.d2l'
        || target.pathname === '/d2l/lp/preferences/preferences_main/preferences_main.d2l') return target.href;
      return null;
    } catch { return null; }
  }).filter(Boolean).slice(0, 2000);
  const result = { status: 'read', accountId, pageType, url: page.href, courses: [...courses.values()], rows: [], links, limited, skipped: 0, timeZone: null };
  if (pageType === 'settings') {
    for (const select of document.querySelectorAll('select')) {
      const selected = select.selectedOptions?.[0];
      if (selected?.textContent?.startsWith('GMT') && /^[A-Za-z_]+\/[A-Za-z_/-]+$/.test(select.value)) result.timeZone = select.value;
    }
  }
  if (pageType === 'assignments') {
    const courseId = page.searchParams.get('ou');
    const table = [...document.querySelectorAll('table')].find((node) => node.querySelector('.d2l-foldername'));
    if (!table) return { ...result, status: 'layout-unverified' };
    for (const row of table.querySelectorAll('tr')) {
      const name = row.querySelector('.d2l-foldername');
      if (!name) continue;
      if (result.rows.length >= 250) { result.limited = true; break; }
      const cells = [...row.children].filter((node) => ['TH', 'TD'].includes(node.tagName));
      const links = [...row.querySelectorAll('a[href]')].map((link) => {
        try { return new URL(link.getAttribute('href'), page.href); } catch { return null; }
      }).filter((url) => url?.origin === page.origin && /^\/d2l\/lms\/dropbox\/user\/(?:folder_submit_files|folders_history)\.d2l$/.test(url.pathname)
        && url.searchParams.get('ou') === courseId && /^\d+$/.test(url.searchParams.get('db') ?? ''));
      const identities = [...new Set(links.map((url) => url.searchParams.get('db')))];
      if (identities.length !== 1) { result.skipped += 1; continue; }
      const completionText = cells[1]?.textContent?.trim() ?? '';
      const individual = links.every((url) => !url.searchParams.has('grpid') || url.searchParams.get('grpid') === '0');
      const submission = individual && /^[1-9]\d* Submissions?(?:,|$)/.test(completionText) ? 'submitted'
        : individual && completionText === 'Not Submitted' ? 'absent' : 'unknown';
      const dates = row.querySelector('.d2l-folderdates-wrapper');
      const dueText = dates?.querySelector('.d2l-dates-text')?.textContent?.trim() ?? '';
      const end = [...(dates?.querySelectorAll('li') ?? [])].find((node) => /^Available until /.test(node.textContent.trim()));
      const closeText = end ? [...end.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim() : '';
      result.rows.push({ courseId, activityId: identities[0], title: name.textContent.trim().slice(0,300), dueText, closeText, submission, url: links[0].href });
    }
  }
  if (pageType === 'calendar-detail') {
    const match = page.pathname.match(/\/calendar\/(\d+)\/event\/(\d+)\//);
    const header = document.querySelector('h2');
    const container = header?.parentElement;
    const activity = container?.querySelector('a.d2l-link-main[href]');
    const due = [...(container?.querySelectorAll('abbr[data-date]') ?? [])].find((node) => /^Due\s/.test(node.parentElement.textContent.trim()));
    const closes = [...(container?.querySelectorAll('.d2l-textblock') ?? [])].find((node) => /^Ends\s/.test(node.textContent.trim()));
    if (!header || !due || !activity) return { ...result, status: 'layout-unverified' };
    let target;
    try { target = new URL(activity.getAttribute('href'), page.href); } catch { return { ...result, status: 'layout-unverified' }; }
    if (target.origin !== page.origin) return { ...result, status: 'layout-unverified' };
    result.rows.push({
      courseId: match[1], eventId: match[2], title: (activity.textContent || header.textContent).trim().slice(0,300),
      dueEpoch: due.getAttribute('data-date'), dueText: due.getAttribute('title'), closeText: closes?.textContent?.trim() ?? '',
      activityUrl: target.href, url: page.href
    });
  }
  return result;
}
