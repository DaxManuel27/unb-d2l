// Hard-coded September 1, 2026, midnight in New Brunswick (Atlantic daylight time).
export const COURSEWORK_CUTOFF = '2026-09-01T03:00:00.000Z';
export const COURSEWORK_CUTOFF_MS = Date.parse(COURSEWORK_CUTOFF);

export function withinCourseworkWindow(dueAt) {
  return Date.parse(dueAt) >= COURSEWORK_CUTOFF_MS;
}

// Apply on both reads and writes so stale/offline scans cannot restore old work.
export function applyCourseworkCutoff(state) {
  const items = (state.items ?? []).filter((item) => withinCourseworkWindow(item.dueAt));
  const next = { ...state, items };
  if (Array.isArray(state.carry)) next.carry = state.carry.filter((item) => withinCourseworkWindow(item.dueAt));
  else if (state.carry) next.carry = applyCourseworkCutoff(state.carry);
  return next;
}
