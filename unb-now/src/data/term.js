// UNB semesters follow Atlantic time, even when the student's computer does not.
const SEASONS = { winter: 'WI', spring: 'SU', summer: 'SU', fall: 'FA', autumn: 'FA', wi: 'WI', sp: 'SU', su: 'SU', fa: 'FA' };
const TERM_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Moncton', year: 'numeric', month: 'numeric' });

export function currentTerm(now = new Date()) {
  const parts = Object.fromEntries(TERM_DATE.formatToParts(now).map(({ type, value }) => [type, value]));
  const year = Number(parts.year), month = Number(parts.month);
  const season = month < 5 ? 'WI' : month < 9 ? 'SU' : 'FA';
  const label = { WI: 'Winter', SU: 'Summer', FA: 'Fall' }[season];
  const end = new Date(Date.UTC(year, season === 'WI' ? 4 : season === 'SU' ? 8 : 12, 1, season === 'FA' ? 4 : 3));
  return { key: `${year}-${season}`, label: `${label} ${year}`, end };
}

// Examples from UNB: D2L_2026FA_UG_ECE_2215_..., 2026/FA_MATH_3413_...,
// and renamed/merged shells such as "Fall 2026 Electric Circuits".
// Require a year AND a season; course numbers and access dates are not terms.
export function termsFromText(...values) {
  const terms = new Set();
  for (const value of values) {
    const text = String(value || '');
    for (const match of text.matchAll(/(?:^|[^a-z0-9])(20\d{2})[\s/_-]*(winter|spring|summer|fall|autumn|wi|sp|su|fa)(?=$|[^a-z0-9])/gi)) {
      terms.add(`${match[1]}-${SEASONS[match[2].toLowerCase()]}`);
    }
    for (const match of text.matchAll(/(?:^|[^a-z0-9])(winter|spring|summer|fall|autumn|wi|sp|su|fa)[\s/_-]*(20\d{2})(?=$|[^a-z0-9])/gi)) {
      terms.add(`${match[2]}-${SEASONS[match[1].toLowerCase()]}`);
    }
  }
  return terms;
}

export function matchesTerm(terms, term) {
  return terms.size === 1 && terms.has(term.key);
}

// Filter every storage read/write, including offline lists and failed-scan restores.
// Keep recovery data privately until a successful scan so manual check-offs can
// be reconciled for courses whose old cache did not retain a term label.
export function applyCurrentTerm(state, now = new Date()) {
  const term = currentTerm(now);
  const needsTermRefresh = state.termKey !== term.key;
  const courses = (state.courses ?? []).filter((course) => course.termKey
    ? course.termKey === term.key
    : matchesTerm(termsFromText(course.code, course.name), term));
  const ids = new Set(courses.map((course) => course.id));
  const next = { ...state, needsTermRefresh, courses, items: (state.items ?? []).filter((item) => ids.has(item.courseId)) };
  if (needsTermRefresh && !state.carry && state.courses?.length) {
    next.carry = { courses: state.courses, items: state.items ?? [], student: state.student, lastSyncAt: state.lastSyncAt };
  }
  if (state.scan) next.scan = { ...state.scan, courses: (state.scan.courses ?? []).filter((course) => ids.has(course.courseId)) };
  return next;
}
