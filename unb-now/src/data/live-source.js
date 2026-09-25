// Adapted from WATnow (MIT); see ../../LICENSE and ../../UPSTREAM.md.
// UNB API access must be validated in an installed, signed-in Chrome session.
import { LMS_BASE, apiPath, accessibleEnrollments } from "./unb.js";
import { COURSEWORK_CUTOFF, withinCourseworkWindow } from "./cutoff.js";
import { currentTerm, termsFromText, matchesTerm } from "./term.js";

export const LEARN_BASE = LMS_BASE;

const FALLBACK_VERSIONS = { lp: "1.30", le: "1.60" };
const GAP_MS = 150;
// A request that takes longer than this counts as Brightspace being unreachable.
export const REQUEST_TIMEOUT_MS = 20000;
const COLORS = ["pink", "green", "orange", "blue", "violet", "mint"];
const ACTIVITY_KIND = { 3: "dropbox", 4: "quiz", 5: "discussion", 6: "discussion" };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed UNB origin. Saved settings cannot redirect authenticated requests.
 */
export function liveBase() { return LMS_BASE; }

/* ------------------------------------------------------------------ */
/* Terms and course names                                              */
/* ------------------------------------------------------------------ */

const SEASON_WORDS = "winter|spring|summer|fall|autumn|wi|sp|su|fa";
const TERM_LABEL_RE = new RegExp(`(^|[^a-z0-9])(?:(?:${SEASON_WORDS})[\\s/_-]*20\\d{2}|20\\d{2}[\\s/_-]*(?:${SEASON_WORDS}))(?=$|[^a-z0-9])`, "gi");
const COURSE_TOKEN_RE = /(^|[^a-z0-9])([a-z]{2,8})[ _-]*(\d{3,4}[a-z]{0,2})(?=$|[^a-z0-9])/gi;
const TERM_SUBJECTS = new Set(SEASON_WORDS.split("|"));

function withoutTerm(text) {
  return String(text || "").replace(TERM_LABEL_RE, "$1").replace(/\(\s*\)|\[\s*\]/g, "").trim();
}

function courseToken(text) {
  for (const match of text.matchAll(COURSE_TOKEN_RE)) {
    if (TERM_SUBJECTS.has(match[2].toLowerCase())) continue;
    return { code: `${match[2].toUpperCase()} ${match[3].toUpperCase()}`, start: match.index + match[1].length,
      end: match.index + match[0].length };
  }
  return null;
}

function cleanCourseTitle(text) {
  return text.replace(/^[-:_/\s\u2013\u2014]+|[-:_/\s\u2013\u2014]+$/g, "")
    .replace(/^(?:FR|SJ)\d{2}[a-z]?(?:_\d+)?\s*/i, "")
    .replace(/^\s*(?:LEC|TUT|LAB|SEM)\s*\d{3,4}\b\s*/i, "")
    .replace(/\s*[-:\u2013\u2014]?\s*[([]?\d{3,4}[)\]]?\s*$/, "")
    .replace(/^[-:_/\s\u2013\u2014]+|[-:_/\s\u2013\u2014]+$/g, "").trim();
}

/** Extract a course code after removing term labels, including UNB's shell names. */
export function parseCourseName(rawName, rawCode) {
  const raw = withoutTerm(rawName);
  const inName = courseToken(raw);
  const token = inName || courseToken(withoutTerm(rawCode));
  if (token) {
    let name = raw;
    if (inName) {
      // Merged shells put section codes in parentheses after the human title.
      name = raw.replace(/\([^)]*\)/g, (part) => courseToken(part) ? "" : part);
      const remaining = courseToken(name);
      if (remaining) {
        name = name.slice(0, remaining.start) + name.slice(remaining.end);
        // Remove cross-listed codes immediately following the leading course.
        name = name.replace(/^\s*\/\s*[a-z]{2,8}[ _-]*\d{3,4}[a-z]{0,2}/gi, "");
      }
    }
    return { code: token.code, name: cleanCourseTitle(name) };
  }
  const full = raw || withoutTerm(rawCode).replace(/_/g, " ").trim() || "Course";
  return { code: shortLabel(full), name: full };
}

/** "Ideas Clinic EngSkills Workshops" -> "Ideas Clinic", so a chip stays about as wide as "ECE 298". */
function shortLabel(text, max = 18) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return out || String(text).slice(0, max);
}

/** Sorts by course code and hands out colors in order, so the same course list always gets the same colors. */
export function assignColors(courses) {
  courses.sort((a, b) => a.code.localeCompare(b.code) || a.orgUnitId - b.orgUnitId);
  courses.forEach((c, i) => (c.color = COLORS[i % COLORS.length]));
  return courses;
}

/* ------------------------------------------------------------------ */
/* Report helpers                                                      */
/* ------------------------------------------------------------------ */

// Keys whose values are never copied into the debug report, at any depth.
/**
 * UW codes look like ECE203_pmitran_1269, so the middle segment is the
 * instructor's username. Debug reports get mailed to us, so keep the course
 * code and the term code and drop everything between them.
 */
function stripOwner(code) {
  const parts = String(code || "").split("_");
  const out = parts.length >= 3 ? `${parts[0]}_${parts[parts.length - 1]}` : parts.join("_");
  return out.slice(0, 60);
}

const PERSONAL = new Set([
  "FirstName", "LastName", "MiddleName", "UniqueName", "UserName", "Username", "DisplayName",
  "Email", "ExternalEmail", "OrgDefinedId", "Identifier", "ProfileIdentifier", "Pronouns",
  "UserId", "SubmittedBy", "Comment", "Feedback", "FileName", "Files", "Attachments",
  "CustomInstructions", "Instructions", "Description", "Header", "Footer", "Password", "NotificationEmail",
]);
// Keys whose real values are useful for checking the mapping and carry nothing personal.
const SHOW_VALUE = new Set([
  "ProductCode", "LatestVersion", "SupportedVersions", "ActivityType", "ItemType", "CompletionType", "DueDate", "EndDate",
  "StartDate", "SubmissionDate", "DateCompleted", "CompletionDate", "HasMoreItems", "IsActive",
  "CanAccess", "IsHidden", "IsExempt", "IsLocked", "ClasslistRoleName", "Code", "Name", "ItemName",
  "ItemUrl", "HomeUrl", "DropboxType", "SubmissionType", "StartDateAvailabilityType", "EndDateAvailabilityType",
  "UnlockStartDate", "UnlockEndDate", "PostStartDate", "PostEndDate", "EventType", "AssociatedEntityType",
  "IsAssociatedWithEntity", "IsRecurring", "IsAllDayEvent", "StartDateTime", "EndDateTime", "StartDay", "EndDay",
  "Title", "Link", "CalendarEventViewUrl",
]);

export function shapeOf(value, key = "", depth = 0) {
  if (PERSONAL.has(key)) return value == null ? null : "<redacted>";
  if (value === null || value === undefined) return value === null ? null : "<undefined>";
  if (Array.isArray(value)) {
    if (SHOW_VALUE.has(key) && value.every((v) => typeof v === "string")) return value.slice(0, 40);
    const out = value.slice(0, 2).map((v) => shapeOf(v, "", depth + 1));
    if (value.length > 2) out.push(`<${value.length - 2} more>`);
    return out;
  }
  if (typeof value === "object") {
    if (depth > 6) return "<object>";
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shapeOf(v, k, depth + 1);
    return out;
  }
  if (SHOW_VALUE.has(key)) return typeof value === "string" ? value.slice(0, 160) : value;
  if (typeof value === "string") return `<string ${value.length}>`;
  if (typeof value === "number") return "<number>";
  return value;
}

const ERROR_BODY_READ = 2000;
const ERROR_BODY_KEEP = 400;

/**
 * Error bodies go into the debug report, so anything that could name the
 * student is removed first: email addresses, 8+ digit numbers (student
 * numbers), and the names whoami returned.
 */
export function redactText(text, personal = []) {
  let s = String(text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\b\d{8,}\b/g, "<number>");
  for (const p of personal) {
    if (p && p.length > 1) s = s.split(p).join("<redacted>");
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > ERROR_BODY_KEEP ? `${s.slice(0, ERROR_BODY_KEEP)}...` : s;
}

/** The query string as the report shows it: org unit lists become a count, bookmarks are shortened. */
export function queryForReport(path) {
  const i = path.indexOf("?");
  if (i < 0) return null;
  const out = {};
  for (const [k, v] of new URLSearchParams(path.slice(i + 1))) {
    if (/orgunitids/i.test(k)) out[k] = `<${v.split(",").filter(Boolean).length} ids>`;
    else if (k === "bookmark") out[k] = v.length > 24 ? `${v.slice(0, 24)}...` : v;
    else out[k] = v.slice(0, 40);
  }
  return out;
}

function endpointName(path) {
  return path
    .split("?")[0]
    .replace(/\/d2l\/api\/(lp|le)\/[\d.]+\//, "/d2l/api/$1/{v}/")
    .replace(/\/\d+(?=\/)/g, "/{id}");
}

/* ------------------------------------------------------------------ */
/* Item helpers                                                        */
/* ------------------------------------------------------------------ */

const listOf = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.Objects) ? x.Objects : x && Array.isArray(x.Items) ? x.Items : []);

function isoOrNull(v) {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function kindOf(x) {
  const a = x.ActivityType;
  if (typeof a === "number" && ACTIVITY_KIND[a]) return ACTIVITY_KIND[a];
  const s = `${typeof a === "string" ? a : ""} ${x.ItemUrl || ""}`.toLowerCase();
  if (s.includes("dropbox") || s.includes("assignment")) return "dropbox";
  if (s.includes("quiz")) return "quiz";
  if (s.includes("discussion")) return "discussion";
  return "content";
}

function toolIdFromUrl(kind, url) {
  const u = String(url || "");
  let m = null;
  if (kind === "dropbox") m = u.match(/[?&]db=(\d+)/) || u.match(/\/folders?\/(\d+)/i);
  if (kind === "quiz") m = u.match(/[?&]qi=(\d+)/) || u.match(/\/quizzes\/(\d+)/i);
  if (kind === "discussion") m = u.match(/\/topics\/(\d+)/i) || u.match(/[?&]topicId=(\d+)/i);
  return m ? m[1] : null;
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function categoryFor(kind, title, categoryName) {
  if (kind === "dropbox") return /\blab/i.test(categoryName || "") || /^\s*lab\b/i.test(title || "") ? "lab" : "assignment";
  if (kind === "quiz" || kind === "discussion") return kind;
  return "content";
}

/** Brightspace wants yyyy-MM-ddTHH:mm:ss.fffZ, which is what toISOString gives. */
const utcDateTime = (d) => new Date(d).toISOString();

/** An opens date only matters when it is before the due date. */
const laterOnly = (opens, due) => (opens && due && opens < due ? opens : null);

/** Which Brightspace field a due date came from: "due" for DueDate, "end" for an end date. */
const fieldOf = (dueValue) => (isoOrNull(dueValue) ? "due" : "end");

/** Per tool counts for the report: how many rows came back, how many were hidden or had no date, with a few undated examples. */
function seenCounter(rep, tool, total) {
  const stats = { total, hidden: 0, dated: 0, undated: 0, undatedSamples: [] };
  if (rep) {
    rep.seen = rep.seen || {};
    rep.seen[tool] = stats;
  }
  return {
    stats,
    sample(name, dates, dated) {
      if (dated) stats.dated++;
      else {
        stats.undated++;
        if (stats.undatedSamples.length < 3) stats.undatedSamples.push({ name: String(name || "").slice(0, 60), ...dates });
      }
    },
  };
}

// Calendar AssociatedEntityType (last part) -> item kind. null means skip the event.
const ENTITY_KIND = {
  Dropbox: "dropbox",
  Quiz: "quiz",
  DiscussionTopic: "discussion",
  TopicCO: "content",
  ModuleCO: null,
  DiscussionForum: null,
  GradeObject: null,
};
// Calendar EventType (LE API 1.94+): 1 Reminder, 2 AvailabilityStarts, 3 AvailabilityEnds, 4 UnlockStarts, 5 UnlockEnds, 6 DueDate.
const EVENT_TYPE = { 1: "reminder", 2: "opens", 3: "ends", 4: "opens", 5: "ends", 6: "due" };
const RANK = { due: 3, ends: 2, event: 1, reminder: 0 };
const EVENT_SUFFIX_RE = /\s*[-:–—]\s*(?:due(?: date)?|availability (?:ends|starts)|available|ends|starts|end date|start date|unlocks?|unlock (?:ends|starts))\s*$/i;
const DEADLINE_WORDS = /\b(?:due|deadline|submi\w*|assignment|assgn|lab|report|quiz|test|midterm|exam|final|project|problem sets?|homework|hw\s?\d*|psets?|deliverable|presentation|proposal|essay|reflection|milestone|checkpoint|a\d{1,2})\b/i;

function eventTypeOf(ev) {
  if (EVENT_TYPE[ev.EventType]) return EVENT_TYPE[ev.EventType];
  const t = String(ev.Title || "");
  const m = t.match(EVENT_SUFFIX_RE);
  if (m) {
    const w = m[0].toLowerCase();
    if (w.includes("due")) return "due";
    if (/ends|end date/.test(w)) return "ends";
    return "opens";
  }
  return "event";
}

/** The moment an event stands for. All-day events count as 11:59 pm on their day. */
function eventDate(ev) {
  const assoc = !!(ev.AssociatedEntity && ev.IsAssociatedWithEntity !== false);
  if (ev.IsAllDayEvent) {
    const day = String(ev.EndDay || ev.StartDay || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 23, 59).toISOString();
  }
  // A Brightspace item's event marks its date at the end; a plain event (a midterm) matters when it starts.
  return assoc ? isoOrNull(ev.EndDateTime) || isoOrNull(ev.StartDateTime) : isoOrNull(ev.StartDateTime) || isoOrNull(ev.EndDateTime);
}

/** "Lab 2 Report - Due" -> "Lab 2 Report". */
export function cleanEventTitle(title) {
  return String(title || "").replace(EVENT_SUFFIX_RE, "").trim();
}

function categoryFromTitle(title) {
  const t = String(title || "");
  if (/\blab\b/i.test(t)) return "lab";
  if (/\b(?:quiz|test|midterm|exam)\b/i.test(t)) return "quiz";
  if (/\b(?:assignment|a\d{1,2}|homework|hw|problem sets?|psets?|report|project|deliverable|proposal|essay)\b/i.test(t)) return "assignment";
  return "content";
}

/**
 * The same deadline can reach us twice under different ids, for example a
 * content topic event and the dropbox folder it links to. Rows with the same
 * title and due minute are merged, keeping the tool row, unless both came
 * from a tool.
 */
function dropEchoes(items) {
  const score = (i) => (i.srcs.has("tool") ? 4 : 0) + (i.kind !== "content" ? 2 : 0) + (i.srcs.has("feed") ? 1 : 0);
  const out = [];
  const seen = new Map();
  for (const i of [...items].sort((a, b) => score(b) - score(a))) {
    const k = `${norm(cleanEventTitle(i.title))}|${Math.round(Date.parse(i.dueAt) / 60000)}`;
    const keep = seen.get(k);
    if (keep && !(keep.srcs.has("tool") && i.srcs.has("tool"))) {
      if (i.status === "submitted" && keep.status !== "submitted") {
        keep.status = "submitted";
        keep.completedAt = i.completedAt;
      }
      if (!keep.opensAt && i.opensAt) keep.opensAt = i.opensAt;
      for (const x of i.seen || []) keep.seen && keep.seen.add(x);
      continue;
    }
    if (!keep) seen.set(k, i);
    out.push(i);
  }
  return out;
}

const NUMERIC_ID = /^\d+$/;

/**
 * A deep link straight to one item. Only ever built from a real tool id: Brightspace
 * answers a made-up id with "Internal Error", so a caller that is not sure of
 * the id gets null here and falls back to the tool's list page.
 */
export function itemUrl(base, ou, kind, id, groupId = null) {
  if (!NUMERIC_ID.test(String(id))) return null;
  switch (kind) {
    case "dropbox":
      // A group folder's page needs the student's group id as well; without it
      // Brightspace answers "Internal Error".
      if (groupId != null) return `${base}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&grpid=${groupId}&isprv=0&bp=0&ou=${ou}`;
      return `${base}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${id}&ou=${ou}`;
    case "quiz":
      return `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${id}&ou=${ou}`;
    case "discussion":
      return `${base}/d2l/le/${ou}/discussions/topics/${id}/View`;
    default:
      return `${base}/d2l/le/content/${ou}/viewContent/${id}/View`;
  }
}

/** The course's list page for a tool. Always openable, even before an item unlocks. */
export function toolListUrl(base, ou, kind) {
  switch (kind) {
    case "dropbox":
      return `${base}/d2l/lms/dropbox/user/folders_list.d2l?ou=${ou}`;
    case "quiz":
      return `${base}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${ou}`;
    case "discussion":
      return `${base}/d2l/le/${ou}/discussions/List`;
    default:
      return `${base}/d2l/le/content/${ou}/Home`;
  }
}

function absolute(base, url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url, base);
    return u.origin === base && !u.username && !u.password && u.pathname.startsWith("/d2l/") ? u.href : null;
  } catch {
    return null;
  }
}

function signedOutError() {
  const err = new Error("Brightspace says nobody is signed in.");
  err.code = "signed-out";
  return err;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SIGNED_OUT_WHY = new Set(["signed-out", "forbidden", "not-json", "odd-whoami"]);

/**
 * Why a session check failed, from what the worker and the Brightspace tab each got.
 *   signed-out   an open Brightspace tab says nobody is signed in, so the login really expired
 *   unreachable  no answer from Brightspace (no network, timeout, Brightspace down)
 *   no-tab       the worker looks signed out and there is no Brightspace tab to ask. The
 *                worker may simply not get the cookie, so this is not proof of a
 *                signed-out student.
 */
export function sessionReason(workerWhy, tabWhy) {
  if (SIGNED_OUT_WHY.has(tabWhy)) return "signed-out";
  if (tabWhy !== "no-tab") return "unreachable";
  if (SIGNED_OUT_WHY.has(workerWhy)) return "no-tab";
  return "unreachable";
}

/* ------------------------------------------------------------------ */
/* Source                                                            */
/* ------------------------------------------------------------------ */

export class LiveSource {
  /**
   * @param {object} settings
   * @param {{relay?: (base: string, path: string) => Promise<object>, now?: Date}} [opts]
   *   relay runs a GET through an open Brightspace tab. It resolves to the same result
   *   object as workerFetch, or { noTab: true } when there is no usable tab.
   */
  constructor(settings, opts = {}) {
    this.mode = "live";
    this.base = liveBase(settings);
    this.settings = settings;
    this.relay = opts.relay || null;
    this.now = opts.now || new Date();
    this.versions = null;
    this.via = "worker";
    this.lastAt = 0;
    this.feed = null;
    this.fullShapes = new Set();
    this.personal = [];
    this.calendar = null;
    // Course id -> the sources that read completely for it this time
    // (dropbox, quizzes, discussions, feed, calendar). An item that disappeared
    // is only dropped when every source it came from read completely.
    this.readOk = new Map();
    this.report = {
      kind: "unb-now-live-debug",
      startedAt: this.now.toISOString(),
      base: this.base,
      via: null,
      session: null,
      versions: null,
      term: null,
      requests: [],
      shapes: {},
      courses: [],
      counts: null,
      notes: [],
    };
  }

  async workerFetch(path) {
    let res;
    try {
      if (!apiPath(path)) throw new Error("Unsupported read route");
      res = await fetch(this.base + path, {
        method: "GET",
        redirect: "manual",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      return { status: 0, error: e && e.name === "TimeoutError" ? "timeout" : String(e && e.message ? e.message : e) };
    }
    const type = res.headers.get("content-type") || "";
    const loginRedirect = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400) || /\/d2l\/login/i.test(res.url || "");
    let json;
    let parseError = null;
    let body;
    if (res.ok && type.includes("json")) {
      try {
        json = await res.json();
      } catch (e) {
        parseError = String(e && e.message ? e.message : e);
      }
    } else if (!res.ok && !loginRedirect) {
      // Brightspace explains a 400 in the body. Only the start is kept, for the debug report.
      try {
        body = (await res.text()).slice(0, ERROR_BODY_READ);
      } catch {
        /* no body */
      }
    }
    return { status: res.status, redirected: res.redirected, loginRedirect, type, json, parseError, body };
  }

  async fetchVia(path, via) {
    const gap = GAP_MS - (Date.now() - this.lastAt);
    if (gap > 0) await wait(gap);
    this.lastAt = Date.now();
    if (via === "tab") {
      if (!this.relay) return { noTab: true };
      try {
        let timer;
        const late = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: 0, error: "timeout" }), REQUEST_TIMEOUT_MS + 2000);
        });
        try {
          return await Promise.race([this.relay(this.base, path), late]);
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        return { status: 0, error: String(e && e.message ? e.message : e) };
      }
    }
    return this.workerFetch(path);
  }

  /**
   * One GET. Returns parsed JSON or throws an Error with code:
   * signed-out, forbidden, not-found, not-json, http, network.
   */
  async api(path, { via = this.via } = {}) {
    if (!apiPath(path)) throw Object.assign(new Error("Unsupported read route"), { code: "unsupported-route" });
    const t0 = Date.now();
    const r = await this.fetchVia(path, via);
    const entry = { endpoint: endpointName(path), path: path.split("?")[0], via, status: r.status ?? null, ms: Date.now() - t0 };
    const query = queryForReport(path);
    if (query) entry.query = query;
    this.report.requests.push(entry);
    let code = null;
    if (r.noTab) code = "no-tab";
    else if (r.loginRedirect || r.status === 401) code = "signed-out";
    else if (r.status === 0) code = "network";
    else if (r.status === 403) code = "forbidden";
    else if (r.status === 404) code = "not-found";
    else if (r.status < 200 || r.status >= 300) code = "http";
    else if (r.json === undefined) code = "not-json";
    if (code) {
      entry.error = code;
      if (r.type && code === "not-json") entry.contentType = r.type.slice(0, 60);
      if (r.error) entry.detail = String(r.error).slice(0, 160);
      if (typeof r.body === "string" && r.body.trim()) entry.body = redactText(r.body, this.personal);
      const err = new Error(code === "signed-out" ? "Brightspace says nobody is signed in." : `Brightspace returned ${r.status || "no response"} for ${entry.endpoint}`);
      err.code = code;
      err.status = r.status;
      throw err;
    }
    const j = r.json;
    if (Array.isArray(j) || (j && (Array.isArray(j.Objects) || Array.isArray(j.Items)))) entry.count = listOf(j).length;
    // Keep replacing an empty sample until a response with something in it comes back.
    if (!this.fullShapes.has(entry.endpoint)) {
      this.report.shapes[entry.endpoint] = shapeOf(j);
      if (entry.count !== 0) this.fullShapes.add(entry.endpoint);
    }
    return r.json;
  }

  async paged(path) {
    const out = [];
    const visited = new Set();
    let next = path;
    for (let i = 0; i < 100 && next; i++) {
      if (visited.has(next) || !apiPath(next)) throw Object.assign(new Error("Incomplete pagination"), { code: "pagination" });
      visited.add(next);
      const page = await this.api(next);
      out.push(...listOf(page));
      const info = page?.PagingInfo;
      if (info?.HasMoreItems) {
        if (!info.Bookmark) throw Object.assign(new Error("Missing pagination bookmark"), { code: "pagination" });
        const url = new URL(path, this.base);
        url.searchParams.set("bookmark", info.Bookmark);
        next = url.pathname + url.search;
      } else if (typeof page?.Next === "string" && page.Next) {
        const url = new URL(page.Next, this.base);
        if (url.origin !== this.base || url.username || url.password || url.hash) throw Object.assign(new Error("Unsupported pagination origin"), { code: "pagination" });
        next = url.pathname + url.search;
      } else next = null;
    }
    if (next) throw Object.assign(new Error("Pagination limit reached"), { code: "pagination" });
    return out;
  }

  async ensureVersions(via = this.via) {
    if (this.versions) return this.versions;
    const v = { ...FALLBACK_VERSIONS };
    try {
      const list = await this.api("/d2l/api/versions/", { via });
      for (const p of Array.isArray(list) ? list : []) {
        const code = String(p.ProductCode || "").toLowerCase();
        if ((code === "lp" || code === "le") && typeof p.LatestVersion === "string") v[code] = p.LatestVersion;
      }
    } catch (e) {
      // Not cached, so the next call tries again (possibly through a Brightspace tab).
      this.report.notes.push(`versions via ${via} failed (${e.code}), using ${v.lp}/${v.le} for now`);
      return v;
    }
    this.versions = v;
    this.report.versions = v;
    return v;
  }

  async whoami(via) {
    const { lp } = await this.ensureVersions(via);
    try {
      const me = await this.api(`/d2l/api/lp/${lp}/users/whoami`, { via });
      if (!me || typeof me !== "object" || !/^\d+$/.test(String(me.Identifier ?? ""))) return { signedIn: false, why: "odd-whoami" };
      const first = String(me.FirstName || "").trim();
      const last = String(me.LastName || "").trim();
      const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
      this.personal = [`${first} ${last}`, first, last, String(me.UniqueName || ""), String(me.Identifier || "")]
        .filter((x) => x.trim().length > 1)
        .sort((a, b) => b.length - a.length);
      return { signedIn: true, student: { id: String(me.Identifier), name: `${first} ${last}`.trim(), initials } };
    } catch (e) {
      if (["signed-out", "forbidden", "not-json", "no-tab"].includes(e.code)) return { signedIn: false, why: e.code };
      return { signedIn: false, why: e.code || "error", error: e };
    }
  }

  async checkSession() {
    const worker = await this.whoami("worker");
    const session = { worker: worker.signedIn ? "signed-in" : worker.why };
    this.report.session = session;
    if (worker.signedIn) {
      this.via = "worker";
      this.report.via = "worker";
      return { signedIn: true, student: worker.student, via: "worker" };
    }
    let tab = { why: "no-tab" };
    if (this.relay) {
      tab = await this.whoami("tab");
      session.tab = tab.signedIn ? "signed-in" : tab.why;
      if (tab.signedIn) {
        this.via = "tab";
        this.report.via = "tab";
        return { signedIn: true, student: tab.student, via: "tab" };
      }
    }
    return { signedIn: false, reason: sessionReason(worker.why, tab.why) };
  }

  async listCourses() {
    const { lp } = await this.ensureVersions();
    const rows = await this.paged(`/d2l/api/lp/${lp}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true`);
    const term = currentTerm(this.now);
    const kept = [];
    this.report.term = { filter: "Current UNB semester only", key: term.key, label: term.label, enrolled: rows.length, read: 0, unresolved: 0 };
    for (const row of accessibleEnrollments(rows, this.now.getTime())) {
      let terms = termsFromText(row.OrgUnit.Code, row.OrgUnit.Name);
      if (!terms.size) {
        // Renamed shells may retain their semester only in the org-unit hierarchy.
        try {
          const parents = await this.paged(`/d2l/api/lp/${lp}/enrollments/myenrollments/${row.OrgUnit.Id}/parentOrgUnits`);
          terms = termsFromText(...parents.flatMap((parent) => [parent.OrgUnit?.Code, parent.OrgUnit?.Name]));
        } catch (error) {
          if (error.code === "signed-out") throw error;
        }
      }
      if (!terms.size || terms.size > 1) this.report.term.unresolved++;
      if (matchesTerm(terms, term)) kept.push(row);
    }
    this.report.term.read = kept.length;
    const courses = kept.map((row) => {
      const id = Number(row.OrgUnit.Id);
      const { code, name } = parseCourseName(row.OrgUnit.Name, row.OrgUnit.Code);
      return { id: `ou${id}`, code, name, orgUnitId: id, color: "mint", current: true, termKey: term.key,
        homeUrl: absolute(this.base, row.OrgUnit.HomeUrl) || `${this.base}/d2l/home/${id}` };
    });
    assignColors(courses);
    for (const c of courses) {
      const row = kept.find((row) => Number(row.OrgUnit.Id) === c.orgUnitId);
      this.report.courses.push({
        orgUnitId: c.orgUnitId,
        rawName: String(row.OrgUnit.Name || "").slice(0, 120),
        rawCode: stripOwner(row.OrgUnit.Code),
        code: c.code,
        name: c.name,
        termMatch: c.termKey,
        current: c.current,
        tools: {},
      });
    }
    this.courseIds = new Set(courses.map((c) => c.orgUnitId));
    this.courseOrder = courses.map((c) => c.orgUnitId);
    return courses;
  }

  /** Current-term org unit ids for cross-course routes, at most 100 per request. */
  idChunks() {
    const ids = [...(this.courseOrder || this.courseIds || [])];
    const out = [];
    for (let i = 0; i < ids.length; i += 100) out.push(ids.slice(i, i + 100));
    return out;
  }

  /** Never request feed/calendar history before September 1, 2026 (Atlantic). */
  window() {
    const { end } = currentTerm(this.now);
    const to = new Date(end.getTime() + 21 * DAY_MS);
    return { from: COURSEWORK_CUTOFF, to: utcDateTime(to) };
  }

  /**
   * Reads one cross-course route for every chunk of org unit ids. Brightspace answers
   * 400 without orgUnitIdsCSV. Every chunk contains only current-term courses.
   */
  async readAcross(name, route, params, failed) {
    const rows = [];
    let ok = 0;
    // Org unit ids this route could not read.
    const missed = new Set();
    for (const chunk of this.idChunks()) {
      const tryRead = async (ids) => {
        const q = new URLSearchParams({ orgUnitIdsCSV: ids.join(","), ...params });
        return this.paged(`${route}?${q.toString().replace(/%2C/gi, ",")}`);
      };
      try {
        rows.push(...(await tryRead(chunk)));
        ok++;
      } catch (e) {
        if (e.code === "signed-out") throw e;
        failed.push(`${name}: ${e.code}${e.status ? ` ${e.status}` : ""}`);
        for (const id of chunk) missed.add(id);
      }
    }
    return { rows, ok: ok > 0, missed };
  }

  /** The cross-course myItems feed (content topics and anything else with dates), read once per sync. */
  async ensureFeed() {
    if (this.feed) return this.feed;
    const { le } = await this.ensureVersions();
    const { from, to } = this.window();
    const doneTo = utcDateTime(new Date(this.now.getTime() + DAY_MS));
    const feed = { items: [], completed: new Map(), failed: [], ok: 0, missed: new Set(), activityTypes: {} };
    const range = { startDateTime: from, endDateTime: to };
    // The completions routes filter on the completion date and take different names.
    const doneRange = { completedFromDateTime: from, completedToDateTime: doneTo };
    const reads = [
      ["myItems/due", `/d2l/api/le/${le}/content/myItems/due/`, range],
      ["myItems", `/d2l/api/le/${le}/content/myItems/`, range],
      ["completions/due", `/d2l/api/le/${le}/content/myItems/completions/due/`, doneRange],
      ["completions", `/d2l/api/le/${le}/content/myItems/completions/`, doneRange],
    ];
    const got = {};
    for (const [name, route, params] of reads) {
      const r = await this.readAcross(name, route, params, feed.failed);
      if (r.ok) feed.ok++;
      for (const id of r.missed) feed.missed.add(id);
      got[name] = r.rows;
    }
    for (const x of [...got["completions/due"], ...got.completions]) {
      if (!x || x.OrgUnitId == null || x.ItemId == null) continue;
      const at = isoOrNull(x.DateCompleted) || isoOrNull(x.CompletionDate) || isoOrNull(x.CompletedDate) || this.now.toISOString();
      feed.completed.set(`${x.OrgUnitId}:${x.ItemId}`, at);
    }
    for (const x of [...got["myItems/due"], ...got.myItems]) {
      if (!x || x.OrgUnitId == null || x.ItemId == null) continue;
      feed.activityTypes[String(x.ActivityType)] = (feed.activityTypes[String(x.ActivityType)] || 0) + 1;
      feed.items.push(x);
    }
    this.report.feed = {
      ok: feed.ok,
      failed: feed.failed,
      items: feed.items.length,
      completions: feed.completed.size,
      activityTypes: feed.activityTypes,
      range: { from, to },
      orgUnits: (this.courseOrder || []).length,
    };
    this.feed = feed;
    return feed;
  }

  /** Calendar events for every course, read once per sync. Falls back to one request per course if the cross-course route fails. */
  async ensureCalendar() {
    if (this.calendar) return this.calendar;
    const { le } = await this.ensureVersions();
    const { from, to } = this.window();
    const cal = { events: [], ok: false, perCourse: false, failed: [], missed: new Set() };
    const r = await this.readAcross("calendar", `/d2l/api/le/${le}/calendar/events/myEvents/`, { startDateTime: from, endDateTime: to }, cal.failed);
    cal.events = r.rows;
    cal.ok = r.ok;
    cal.missed = r.missed;
    if (!r.ok) cal.perCourse = true;
    this.report.calendar = { ok: cal.ok, perCourse: cal.perCourse, failed: cal.failed, events: cal.events.length, range: { from, to }, eventTypes: {}, used: 0, skipped: [] };
    this.calendar = cal;
    return cal;
  }

  async calendarFor(course, le) {
    const cal = await this.ensureCalendar();
    const ou = course.orgUnitId;
    // The cross-course read covered this course: use it. Otherwise ask the course itself.
    if (!cal.perCourse && !cal.missed.has(ou)) return { ok: true, events: cal.events.filter((e) => e && Number(e.OrgUnitId) === ou) };
    const { from, to } = this.window();
    const q = new URLSearchParams({ startDateTime: from, endDateTime: to });
    try {
      return { ok: true, events: await this.paged(`/d2l/api/le/${le}/${ou}/calendar/events/myEvents/?${q}`) };
    } catch (e) {
      if (e.code === "signed-out") throw e;
      return { ok: false, error: e };
    }
  }

  /** Turns calendar events into deadline rows. Start events only set opensAt on the matching row. */
  calendarRows(events, rep) {
    const calRep = this.report.calendar;
    const byEntity = new Map();
    const opens = new Map();
    const rows = [];
    let skipped = 0;
    for (const ev of events) {
      if (!ev || ev.CalendarEventId == null) continue;
      const type = eventTypeOf(ev);
      if (calRep) calRep.eventTypes[type] = (calRep.eventTypes[type] || 0) + 1;
      const assoc = ev.IsAssociatedWithEntity !== false && ev.AssociatedEntity && ev.AssociatedEntity.AssociatedEntityId != null ? ev.AssociatedEntity : null;
      const entity = assoc ? ENTITY_KIND[String(assoc.AssociatedEntityType || "").split(".").pop()] : null;
      const at = eventDate(ev);
      const title = cleanEventTitle(ev.Title);
      if (!at || !title) continue;
      const url = absolute(this.base, (assoc && assoc.Link) || ev.CalendarEventViewUrl);
      if (type === "reminder") continue;
      if (type === "opens") {
        if (entity) opens.set(`${entity}:${assoc.AssociatedEntityId}`, at);
        continue;
      }
      if (assoc) {
        if (entity === null || (entity === undefined && type !== "due" && type !== "ends")) {
          skipped++;
          continue;
        }
        const kind = entity || "content";
        const sourceId = entity ? String(assoc.AssociatedEntityId) : `cal${ev.CalendarEventId}`;
        const key = `${kind}:${sourceId}`;
        const prev = byEntity.get(key);
        // A due date beats an end date for the same item.
        if (prev && (prev.rank > RANK[type] || (prev.rank === RANK[type] && prev.dueAt >= at))) continue;
        const row = { kind, sourceId, title, dueAt: at, dueField: type === "due" ? "due" : type === "ends" ? "end" : "event", url, completedAt: null, rank: RANK[type] ?? 0 };
        if (prev) rows[rows.indexOf(prev)] = row;
        else rows.push(row);
        byEntity.set(key, row);
        continue;
      }
      // An event with no Brightspace item behind it: kept when it is a one-off with a deadline-like title.
      if (ev.IsRecurring === true || !DEADLINE_WORDS.test(title)) {
        skipped++;
        if (calRep && calRep.skipped.length < 12) calRep.skipped.push(String(title).slice(0, 60));
        continue;
      }
      rows.push({ kind: "content", sourceId: `cal${ev.CalendarEventId}`, title, dueAt: at, dueField: "event", url, completedAt: null, category: categoryFromTitle(title) });
    }
    for (const row of rows) {
      const o = opens.get(`${row.kind}:${row.sourceId}`);
      if (o && o < row.dueAt) row.opensAt = o;
    }
    if (calRep) calRep.used += rows.length;
    if (rep) rep.calendarSkipped = skipped;
    return { rows, opens };
  }

  async readDropbox(course, le, rep) {
    const ou = course.orgUnitId;
    const folders = await this.paged(`/d2l/api/le/${le}/${ou}/dropbox/folders/`);
    const catNames = {};
    if (folders.some((f) => f && f.CategoryId)) {
      try {
        for (const c of listOf(await this.api(`/d2l/api/le/${le}/${ou}/dropbox/categories/`))) {
          if (c && c.Id != null) catNames[c.Id] = c.Name;
        }
      } catch (e) {
        if (e.code === "signed-out") throw e;
      }
    }
    const seen = seenCounter(rep, "dropbox", folders.length);
    const out = [];
    for (const f of folders) {
      if (!f || f.Id == null) continue;
      if (f.IsHidden === true) {
        seen.stats.hidden++;
        continue;
      }
      const avail = f.Availability || {};
      // UW folders often leave DueDate empty and close the folder with Availability.EndDate.
      const dueAt = isoOrNull(f.DueDate) || isoOrNull(avail.EndDate);
      seen.sample(f.Name, { DueDate: f.DueDate ?? null, StartDate: avail.StartDate ?? null, EndDate: avail.EndDate ?? null }, !!dueAt);
      if (!withinCourseworkWindow(dueAt)) continue;
      let submittedAt = null;
      // A group folder (GroupTypeId set) is only reachable with the student's
      // group id, which Brightspace gives as the submitting Entity once the group
      // has handed something in. Before that the link goes to the list page.
      const isGroup = f.GroupTypeId != null;
      let groupId = null;
      try {
        const subs = listOf(await this.api(`/d2l/api/le/${le}/${ou}/dropbox/folders/${f.Id}/submissions/mysubmissions/`));
        const dates = [];
        for (const s of subs) {
          if (isGroup && s && s.Entity && NUMERIC_ID.test(String(s.Entity.EntityId))) groupId = String(s.Entity.EntityId);
          const inner = s && Array.isArray(s.Submissions) ? s.Submissions : [s];
          for (const x of inner) {
            if (!x) continue;
            dates.push(isoOrNull(x.SubmissionDate) || this.now.toISOString());
          }
        }
        if (dates.length) submittedAt = dates.sort().pop();
      } catch (e) {
        if (e.code === "signed-out") throw e;
      }
      out.push({
        kind: "dropbox",
        sourceId: String(f.Id),
        title: String(f.Name || "Dropbox folder"),
        dueAt,
        dueField: fieldOf(f.DueDate),
        opensAt: laterOnly(isoOrNull(avail.StartDate), dueAt),
        categoryName: catNames[f.CategoryId] || "",
        completedAt: submittedAt,
        groupId,
        groupFolder: isGroup,
        exactId: isGroup && groupId == null ? false : undefined,
      });
    }
    return out;
  }

  async readQuizzes(course, le, rep) {
    const ou = course.orgUnitId;
    const quizzes = await this.paged(`/d2l/api/le/${le}/${ou}/quizzes/`);
    const seen = seenCounter(rep, "quizzes", quizzes.length);
    const out = [];
    for (const q of quizzes) {
      const id = q && (q.QuizId ?? q.Id);
      if (id == null) continue;
      if (q.IsActive === false) {
        seen.stats.hidden++;
        continue;
      }
      const dueAt = isoOrNull(q.DueDate) || isoOrNull(q.EndDate);
      seen.sample(q.Name, { DueDate: q.DueDate ?? null, StartDate: q.StartDate ?? null, EndDate: q.EndDate ?? null }, !!dueAt);
      if (!withinCourseworkWindow(dueAt)) continue;
      out.push({ kind: "quiz", sourceId: String(id), title: String(q.Name || "Quiz"), dueAt, dueField: fieldOf(q.DueDate), opensAt: laterOnly(isoOrNull(q.StartDate), dueAt), completedAt: null });
    }
    return out;
  }

  async readDiscussions(course, le, rep) {
    const ou = course.orgUnitId;
    const forums = await this.paged(`/d2l/api/le/${le}/${ou}/discussions/forums/`);
    const out = [];
    let failures = 0;
    let total = 0;
    const topicsSeen = [];
    for (const f of forums) {
      if (!f || f.ForumId == null || f.IsHidden === true) continue;
      try {
        const topics = await this.paged(`/d2l/api/le/${le}/${ou}/discussions/forums/${f.ForumId}/topics/`);
        total += topics.length;
        topicsSeen.push(...topics);
      } catch (e) {
        if (e.code === "signed-out") throw e;
        failures++;
      }
    }
    const seen = seenCounter(rep, "discussions", total);
    for (const t of topicsSeen) {
      if (!t || t.TopicId == null) continue;
      if (t.IsHidden === true) {
        seen.stats.hidden++;
        continue;
      }
      // Newer Brightspace versions use DueDate plus UnlockStartDate/UnlockEndDate; older ones StartDate/EndDate.
      const dueAt = isoOrNull(t.DueDate) || isoOrNull(t.UnlockEndDate) || isoOrNull(t.EndDate) || isoOrNull(t.PostEndDate);
      seen.sample(t.Name, { DueDate: t.DueDate ?? null, UnlockEndDate: t.UnlockEndDate ?? null, EndDate: t.EndDate ?? null }, !!dueAt);
      if (!withinCourseworkWindow(dueAt)) continue;
      const opensAt = laterOnly(isoOrNull(t.UnlockStartDate) || isoOrNull(t.StartDate), dueAt);
      out.push({ kind: "discussion", sourceId: String(t.TopicId), title: String(t.Name || "Discussion"), dueAt, dueField: fieldOf(t.DueDate), opensAt, completedAt: null });
    }
    if (failures && !out.length && failures === forums.length) {
      const err = new Error("Every discussion forum failed");
      err.code = "forums";
      throw err;
    }
    if (failures) rep.discussionsPartial = failures;
    return out;
  }

  /** All dated items for one course. One failing tool leaves the others in place. */
  async listDeadlines(course) {
    const { le } = await this.ensureVersions();
    const ou = course.orgUnitId;
    const rep = this.report.courses.find((c) => c.orgUnitId === ou) || { tools: {} };
    const byKey = new Map();
    const byTitle = new Map();

    // Tool rows are exact, so their dates win. The feed's ItemUrl wins for links.
    // A row is matched by its tool id first, then by kind and title against a row
    // from a different source (two folders can share a name).
    const add = (x, src) => {
      const key = `${ou}:${x.kind}:${x.sourceId}`;
      const tkey = `${x.kind}:${norm(x.title)}`;
      let found = byKey.get(key);
      if (!found) {
        const t = byTitle.get(tkey);
        if (t && !t.srcs.has(src)) found = t;
      }
      if (!found) {
        const item = {
          id: key,
          courseId: course.id,
          kind: x.kind,
          category: x.category || categoryFor(x.kind, x.title, x.categoryName),
          title: x.title,
          dueAt: x.dueAt,
          dueField: x.dueField || null,
          url: x.url || (x.exactId === false ? null : itemUrl(this.base, ou, x.kind, x.sourceId, x.groupId)) || toolListUrl(this.base, ou, x.kind),
          listUrl: toolListUrl(this.base, ou, x.kind),
          learnUrl: x.url || null,
          groupFolder: !!x.groupFolder,
          status: x.completedAt ? "submitted" : "open",
          completedAt: x.completedAt || null,
          moved: null,
          srcs: new Set([src]),
          seen: new Set([source]),
        };
        if (x.opensAt) item.opensAt = x.opensAt;
        byKey.set(key, item);
        if (!byTitle.has(tkey)) byTitle.set(tkey, item);
        return;
      }
      if (src === "tool" && !found.srcs.has("tool")) {
        found.dueAt = x.dueAt;
        found.dueField = x.dueField || null;
        found.category = categoryFor(x.kind, x.title, x.categoryName);
        found.title = x.title;
        // The tool's id is the real one, so it fixes a link guessed from elsewhere.
        // A group folder overrides even Brightspace's own feed link, which lacks the group id.
        if (x.groupFolder) {
          found.groupFolder = true;
          found.url = (x.groupId != null && itemUrl(this.base, ou, x.kind, x.sourceId, x.groupId)) || toolListUrl(this.base, ou, x.kind);
        } else if (!found.learnUrl) found.url = itemUrl(this.base, ou, x.kind, x.sourceId) || found.url;
      } else if (src === "feed" && x.url && !found.groupFolder) {
        found.url = x.url;
        found.learnUrl = x.url;
      }
      if (x.opensAt && (!found.opensAt || src === "tool")) found.opensAt = x.opensAt;
      if (x.completedAt && found.status !== "submitted") {
        found.status = "submitted";
        found.completedAt = x.completedAt;
      }
      found.srcs.add(src);
      found.seen.add(source);
      byKey.set(key, found);
    };

    let okCount = 0;
    let failCount = 0;
    const sourcesOk = [];
    let source = "";
    const tools = [
      ["dropbox", () => this.readDropbox(course, le, rep)],
      ["quizzes", () => this.readQuizzes(course, le, rep)],
      ["discussions", () => this.readDiscussions(course, le, rep)],
    ];
    rep.discussionsPartial = 0;
    for (const [name, run] of tools) {
      try {
        const rows = await run();
        source = name;
        rows.forEach((x) => add(x, "tool"));
        rep.tools[name] = rows.length;
        okCount++;
        if (!(name === "discussions" && rep.discussionsPartial)) sourcesOk.push(name);
      } catch (e) {
        if (e.code === "signed-out") throw e;
        rep.tools[name] = `failed: ${e.code || e.message}`;
        failCount++;
      }
    }

    const feed = await this.ensureFeed();
    source = "feed";
    let fromFeed = 0;
    for (const x of feed.items) {
      if (Number(x.OrgUnitId) !== ou || x.IsExempt === true) continue;
      const dueAt = isoOrNull(x.DueDate) || isoOrNull(x.EndDate);
      if (!dueAt) continue;
      const kind = kindOf(x);
      const url = absolute(this.base, x.ItemUrl);
      const fromUrl = toolIdFromUrl(kind, url);
      const sourceId = fromUrl || String(x.ItemId);
      add(
        {
          kind,
          sourceId,
          // For a tool item the feed gives a content id, which is not the id the
          // tool's own page wants. Only trust an id read out of the item's link.
          exactId: kind === "content" || !!fromUrl,
          title: String(x.ItemName || "Brightspace item"),
          dueAt,
          dueField: fieldOf(x.DueDate),
          opensAt: laterOnly(isoOrNull(x.StartDate), dueAt),
          url,
          completedAt: feed.completed.get(`${x.OrgUnitId}:${x.ItemId}`) || null,
        },
        "feed"
      );
      fromFeed++;
    }
    rep.tools.myItems = feed.ok ? fromFeed : "failed";
    if (feed.ok) okCount++;
    else failCount++;

    const cal = await this.calendarFor(course, le);
    if (cal.ok) {
      source = "calendar";
      const { rows, opens } = this.calendarRows(cal.events, rep);
      rows.forEach((x) => add(x, "calendar"));
      // A start event for an item another source found.
      for (const item of byKey.values()) {
        const o = opens.get(`${item.kind}:${item.id.split(":").slice(2).join(":")}`);
        if (o && !item.opensAt && o < item.dueAt) item.opensAt = o;
      }
      rep.tools.calendar = rows.length;
      okCount++;
    } else {
      rep.tools.calendar = `failed: ${cal.error && cal.error.code}`;
      failCount++;
    }

    if (!okCount && failCount) {
      const err = new Error(`Could not read anything for ${course.code}`);
      err.code = "course-failed";
      throw err;
    }
    const okSources = new Set(sourcesOk);
    if (feed.ok && !feed.missed.has(ou)) okSources.add("feed");
    if (cal.ok) okSources.add("calendar");
    this.readOk.set(course.id, okSources);
    rep.readOk = [...okSources];
    const items = dropEchoes([...new Set(byKey.values())]).filter((item) => withinCourseworkWindow(item.dueAt));
    for (const i of items) {
      i.seenIn = [...i.seen];
      delete i.srcs;
      delete i.seen;
      delete i.learnUrl;
      delete i.groupFolder;
    }
    rep.items = items.length;
    rep.submitted = items.filter((i) => i.status === "submitted").length;
    return items;
  }

  /**
   * Asks Brightspace whether one dropbox folder or quiz is handed in, right before a
   * reminder goes out. Tries the worker first, then an open Brightspace tab.
   * Resolves to { submitted: true, at } or { submitted: false }, or null when
   * Brightspace could not be asked (the reminder then goes out anyway).
   */
  async submissionState(item) {
    const [ouText, kind, ...rest] = String(item.id || "").split(":");
    const ou = Number(ouText);
    const sourceId = rest.join(":");
    if (!ou || !/^\d+$/.test(sourceId) || (kind !== "dropbox" && kind !== "quiz")) return null;
    const vias = this.relay ? ["worker", "tab"] : ["worker"];
    for (const via of vias) {
      try {
        const { le } = await this.ensureVersions(via);
        if (kind === "dropbox") {
          const subs = listOf(await this.api(`/d2l/api/le/${le}/${ou}/dropbox/folders/${sourceId}/submissions/mysubmissions/`, { via }));
          const dates = [];
          for (const x of subs) {
            for (const y of x && Array.isArray(x.Submissions) ? x.Submissions : [x]) if (y) dates.push(isoOrNull(y.SubmissionDate) || new Date().toISOString());
          }
          return dates.length ? { submitted: true, at: dates.sort().pop() } : { submitted: false };
        }
        // Quizzes: Brightspace's completions feed for this one course.
        const { from } = this.window();
        const q = new URLSearchParams({ orgUnitIdsCSV: String(ou), completedFromDateTime: from, completedToDateTime: utcDateTime(Date.now() + DAY_MS) });
        const rows = [];
        for (const route of ["completions/due/", "completions/"]) {
          const page = await this.api(`/d2l/api/le/${le}/content/myItems/${route}?${q}`, { via });
          rows.push(...listOf(page));
        }
        const hit = rows.find((x) => {
          if (!x || Number(x.OrgUnitId) !== ou) return false;
          const id = toolIdFromUrl("quiz", absolute(this.base, x.ItemUrl));
          return id ? id === sourceId : norm(x.ItemName) === norm(item.title);
        });
        if (!hit) return { submitted: false };
        return { submitted: true, at: isoOrNull(hit.DateCompleted) || isoOrNull(hit.CompletionDate) || new Date().toISOString() };
      } catch (e) {
        this.report.notes.push(`submission check via ${via} failed (${e.code || "error"})`);
      }
    }
    return null;
  }

  /** Called by the background once a sync ends. */
  finishReport(extra = {}) {
    Object.assign(this.report, extra, { finishedAt: new Date().toISOString() });
    const failed = this.report.requests.filter((r) => r.error);
    this.report.failedRequests = failed.length;
    return this.report;
  }
}
