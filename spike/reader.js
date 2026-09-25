export function inspectPage() {
  if (location.origin !== 'https://lms.unb.ca' || !location.pathname.startsWith('/d2l/')) {
    return { status: 'unsupported' };
  }

  const roots = [document];
  const counters = {
    courseLinks: 0,
    calendarLinks: 0,
    assignmentLinks: 0,
    quizLinks: 0,
    discussionLinks: 0,
    semanticTimes: 0,
    openShadowRoots: 0,
    framesNotInspected: 0
  };
  const seen = new Set();
  let inspectedNodes = 0;
  let truncated = false;

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    for (const element of roots[rootIndex].querySelectorAll('*')) {
      inspectedNodes += 1;
      if (inspectedNodes > 20000) {
        truncated = true;
        break;
      }
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        counters.openShadowRoots += 1;
      }
      if (element.tagName === 'IFRAME') counters.framesNotInspected += 1;
      if (element.tagName === 'TIME' && element.hasAttribute('datetime')) {
        counters.semanticTimes += 1;
      }
      if (element.tagName !== 'A') continue;
      const href = element.getAttribute('href');
      if (!href) continue;
      let target;
      try {
        target = new URL(href, location.href);
      } catch {
        continue;
      }
      if (target.origin !== location.origin || target.username || target.password) continue;
      if (seen.has(target.href)) continue;
      seen.add(target.href);
      const path = target.pathname;
      if (/^\/d2l\/home\/\d+\/?$/.test(path)) counters.courseLinks += 1;
      if (/^\/d2l\/le\/calendar\//.test(path)) counters.calendarLinks += 1;
      if (/^\/d2l\/lms\/dropbox\//.test(path)) counters.assignmentLinks += 1;
      if (/^\/d2l\/lms\/quizzing\//.test(path)) counters.quizLinks += 1;
      if (/^\/d2l\/le\/\d+\/discussions\//.test(path)) counters.discussionLinks += 1;
    }
    if (truncated) break;
  }

  return { status: 'inspected', counters, truncated };
}
