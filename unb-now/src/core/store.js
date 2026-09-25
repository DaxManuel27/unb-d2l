// Everything UNB Now keeps lives in chrome.storage.local on this computer.
//   settings  the student's choices
//   state     what UNB Now has read from Brightspace
//   catalog   DEMO only: the fake Brightspace that the mock site and demo source share
//   liveDebug LIVE only: what the last read of real Brightspace returned, for "Copy debug info"

import { TESTER_BUILD } from "./build.js";
import { applyCourseworkCutoff } from "../data/cutoff.js";
import { applyCurrentTerm } from "../data/term.js";

export const DEFAULT_SETTINGS = {
  mode: TESTER_BUILD ? "live" : "demo",
  theme: "light",
  learnBase: TESTER_BUILD ? "https://lms.unb.ca" : "http://localhost:8080",
  // liveBaseOverride: set only by the local test harness, see liveBase() in live-source.js
  reminders: {
    // One lead per deadline type, the position of that type's slider.
    leads: {
      assignment: ["2d"],
      lab: ["2d"],
      quiz: ["1d"],
      discussion: ["morning"],
      content: ["morning"],
    },
    // Deadline types the student switched off. No reminders go out for these.
    offTypes: [],
    mutedCourses: [],
    demoAutoSend: false,
  },
};

export function emptyState() {
  return {
    scan: { status: "idle", courses: [], startedAt: null, finishedAt: null },
    student: null,
    courses: [],
    items: [],
    lastSyncAt: null,
    syncing: false,
    error: null,
    // signed-out | offline | error: why the panel shows a whole-panel screen instead of the list
    errorKind: null,
    // { kind: "unreachable" | "no-tab" | "signed-out", at, online }: the last check
    // couldn't read Brightspace, so the list is what the last good read found
    stale: null,
    seq: 0,
    lastEvent: null,
    demo: { moveStep: 0 },
    sent: {},
  };
}

function mergeSettings(saved) {
  const s = saved || {};
  // quietStart and quietEnd come from installs that had the old quiet hours
  // setting. Nothing reads them now, so they are dropped here.
  const { quietStart, quietEnd, ...r } = s.reminders || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    ...(TESTER_BUILD ? { mode: "live" } : {}),
    reminders: {
      ...DEFAULT_SETTINGS.reminders,
      ...r,
      leads: { ...DEFAULT_SETTINGS.reminders.leads, ...(r.leads || {}) },
    },
  };
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return mergeSettings(settings);
}

export async function setSettings(patchOrFn) {
  const current = await getSettings();
  const next = typeof patchOrFn === "function" ? patchOrFn(structuredClone(current)) || current : { ...current, ...patchOrFn };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function getState() {
  const { state } = await chrome.storage.local.get("state");
  return applyCurrentTerm(applyCourseworkCutoff(state ? { ...emptyState(), ...state } : emptyState()));
}

export async function setState(state) {
  await chrome.storage.local.set({ state: applyCurrentTerm(applyCourseworkCutoff(state)) });
}

export async function getCatalog() {
  const { catalog } = await chrome.storage.local.get("catalog");
  return catalog || null;
}

export async function setCatalog(catalog) {
  await chrome.storage.local.set({ catalog });
}

export async function getFilter() {
  try {
    const { filter } = await chrome.storage.session.get("filter");
    return filter || "all";
  } catch {
    return "all";
  }
}

export async function setFilter(filter) {
  try {
    await chrome.storage.session.set({ filter });
  } catch {
    /* session storage unavailable */
  }
}
