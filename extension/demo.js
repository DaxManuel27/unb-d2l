import { initialState, dateKey, reconcileScan } from './core.js';

export function demoState(now = new Date()) {
  const stamp = (offset, hour = 17) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour);
    return { precision: 'time', value: date.toISOString() };
  };
  const courses = [
    { id: 'demo-cs', name: 'CS 1103 · Programming' },
    { id: 'demo-math', name: 'MATH 1003 · Calculus' },
    { id: 'demo-eng', name: 'ENGL 1001 · Literature' }
  ];
  const descriptions = [
    ['demo-cs', 'Problem set 02', 'assignment', -1],
    ['demo-math', 'Limits & continuity', 'quiz', 0, 23],
    ['demo-cs', 'Loops and functions', 'assignment', 0, 23],
    ['demo-eng', 'Close reading response', 'assignment', 1],
    ['demo-math', 'Differentiation', 'test', 3, 10],
    ['demo-cs', 'Midterm exam', 'exam', 8, 9],
    ['demo-eng', 'Reading response 01', 'assignment', -2]
  ];
  const observations = descriptions.map(([courseId, title, type, offset, hour], index) => ({
    sourceId: `demo-source-${index}`, identity: `demo-item-${index}`, courseId, title, type,
    source: 'activity', kind: 'deadline', due: stamp(offset, hour),
    url: 'https://lms.unb.ca/d2l/home', submission: index === 6 ? 'submitted' : 'unknown'
  }));
  observations[3].due = { precision: 'date', value: dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) };
  observations.push({ ...observations[2], sourceId: 'demo-calendar', source: 'calendar', due: stamp(1, 23) });
  const state = reconcileScan(initialState(), { status: 'success', accountId: 'demo', courses, observations, scopes: [] }, now.toISOString());
  state.accounts[0].items[2].history.push({ previous: stamp(-1, 23), current: stamp(0, 23), at: now.toISOString() });
  return state;
}
