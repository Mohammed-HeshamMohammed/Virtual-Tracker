import { isBrowserAppName } from "./app-name.js";

/**
 * A browser is a container, not an activity. Categorising foreground time by
 * the browser's own name ("Google Chrome") means every second of browsing
 * lands on whatever that app is classified as - in practice `unclassified`,
 * because nobody can honestly call a browser productive or not. Meanwhile the
 * URLs feed classifies the *same seconds* by domain and gets it right, so the
 * Apps tab and the URLs tab could report contradictory productivity for one
 * member on one day.
 *
 * This module is the single place that decides a category, so the three feeds
 * agree by construction instead of by three copies staying in sync.
 *
 * Deliberately NOT used by the integrity sweep - see the comment in
 * integrity-sweep.service.js. Browser seconds exist in both
 * activity_app_logs and activity_url_logs (the agent emits an app slice and a
 * URL slice on the same tick), and that sweep sums both tables; teaching it
 * to resolve browser rows by domain would double-count every distracting
 * browsing session.
 */

/** Agent emits the app slice and URL slice on the same ~15s tick, but they
 *  land as separate inserts with independently-taken timestamps. Match within
 *  this slack rather than demanding exact containment. */
const URL_MATCH_TOLERANCE_MS = 15_000;

/** How far back to scan from the binary-search landing point for an interval
 *  that actually covers the timestamp. URL rows within a session are short
 *  (15-30s) and rarely overlap, so a handful of candidates is always enough.
 *  ponytail: bounded linear probe rather than an interval tree - revisit only
 *  if sessions ever carry deeply overlapping URL rows. */
const MAX_INTERVAL_PROBE = 8;

/**
 * Turns the category rows into the `(matchType, pattern) => category` function
 * every feed resolves through.
 *
 * `roleName` applies that role's override where one exists, which is what the
 * dashboard shows and what focused time has always done. Callers with no role
 * in hand (the shared Activity feed) pass nothing and get the base category.
 *
 * This lives beside the resolver because it is half of the same contract: a
 * lookup built with different rules than the resolver expects reintroduces
 * exactly the divergence this module exists to prevent. There were three
 * private copies of this before.
 */
export function buildCategoryLookup(categories, roleName = "") {
  const roleKey = String(roleName || "").trim().toLowerCase();
  const byKey = new Map();
  for (const category of categories ?? []) {
    const pattern = typeof category.pattern === "string" ? category.pattern.trim().toLowerCase() : "";
    if (!pattern) continue;
    const override = roleKey ? category.roleOverride?.[roleKey] : undefined;
    byKey.set(`${category.matchType}:${pattern}`, override ?? category.category ?? "unclassified");
  }
  return (matchType, pattern) => {
    const key = typeof pattern === "string" ? pattern.trim().toLowerCase() : "";
    if (!key) return "unclassified";
    return byKey.get(`${matchType}:${key}`) ?? "unclassified";
  };
}

export function parseDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function extractHttpUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

export function titleFromBrowserPageTitle(pageTitle, appName) {
  const raw = String(pageTitle || "").trim();
  if (!raw) return "";
  const suffixes = [
    ` - ${appName}`,
    ` — ${appName}`,
    ` | ${appName}`,
    " - Google Chrome",
    " - Microsoft Edge",
    " - Mozilla Firefox",
  ];
  let title = raw;
  for (const suffix of suffixes) {
    if (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
  }
  return title;
}

export function siteNameFromWindowTitle(cleanTitle) {
  const separators = [" | ", " — ", " - "];
  for (const sep of separators) {
    const idx = cleanTitle.lastIndexOf(sep);
    if (idx === -1) continue;
    const candidate = cleanTitle
      .slice(idx + sep.length)
      .trim()
      // Trailing trademark/registered/copyright marks stripped so the same
      // site across different tabs/titles always yields the same
      // classification pattern instead of silently splitting into several.
      .replace(/[®™©]+$/, "")
      .trim();
    if (candidate.length >= 2 && candidate.length <= 60 && /[a-z]/i.test(candidate)) {
      return candidate;
    }
  }
  return "";
}

function toMs(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Group URL log rows by session and sort by time, so a lookup is a binary
 * search rather than a scan. Both feeds cap at a few hundred rows a side, and
 * a naive `.find()` inside a `.map()` would be quadratic on that.
 */
export function buildUrlIndex(urlRows) {
  const bySession = new Map();
  for (const row of urlRows ?? []) {
    if (!row) continue;
    const sessionId = String(row.session_id ?? row.sessionId ?? "");
    const domain = String(row.domain ?? "").trim();
    if (!sessionId || !domain) continue;
    const start = toMs(row.visited_at ?? row.visitedAt);
    if (!Number.isFinite(start)) continue;
    const durationSeconds = Math.max(0, Number(row.duration_seconds ?? row.durationSeconds ?? 0));
    const list = bySession.get(sessionId) ?? [];
    list.push({ start, end: start + durationSeconds * 1000, domain });
    bySession.set(sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.start - b.start);
  return bySession;
}

function findUrlAt(intervals, atMs) {
  if (!intervals?.length || !Number.isFinite(atMs)) return null;

  // Land on the last interval that could possibly be relevant.
  const limit = atMs + URL_MATCH_TOLERANCE_MS;
  let lo = 0;
  let hi = intervals.length - 1;
  let landing = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid].start <= limit) {
      landing = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Containment wins outright. Slices are adjacent and the tolerance is as
  // wide as a slice, so a purely tolerance-based match can pick the *next*
  // interval over the one the timestamp actually falls inside - which shifts
  // a member's whole day's attribution by one slice.
  let nearest = null;
  let nearestDistance = Infinity;
  for (let i = landing; i >= 0 && i > landing - MAX_INTERVAL_PROBE; i--) {
    const iv = intervals[i];
    if (atMs >= iv.start && atMs <= iv.end) return iv;
    const distance = atMs < iv.start ? iv.start - atMs : atMs - iv.end;
    if (distance <= URL_MATCH_TOLERANCE_MS && distance < nearestDistance) {
      nearest = iv;
      nearestDistance = distance;
    }
  }
  // Nothing contained it - fall back to the closest slice still inside the
  // tolerance, for the gap between two adjacent captures.
  return nearest;
}

/**
 * @param lookup   (matchType, pattern) => category, from buildCategoryLookup()
 * @param input    { appName, pageTitle, at, sessionId, urlIndex, domain }
 *                 `domain` is the row's own recorded domain when it has one
 *                 (URL logs always; screenshots once the agent sends it).
 * @returns { category, source, domain }
 *          source: "app" | "url" | "title-url" | "title-site" | "title-window"
 */
export function resolveActivityCategory(lookup, input) {
  const { appName = "", pageTitle = "", at, sessionId, urlIndex, domain } = input ?? {};

  if (!isBrowserAppName(appName)) {
    return { category: lookup("app", appName), source: "app", domain: "" };
  }

  // 0. The row's own domain, when it has one. Most precise - no inference.
  if (domain) {
    return { category: lookup("domain", domain), source: "url", domain };
  }

  // 1. A URL log covering this moment in the same session.
  const atMs = at instanceof Date ? at.getTime() : toMs(at);
  const hit = urlIndex && sessionId ? findUrlAt(urlIndex.get(String(sessionId)), atMs) : null;
  if (hit) {
    return { category: lookup("domain", hit.domain), source: "url", domain: hit.domain };
  }

  // 2. An http(s) URL embedded in the window title.
  const fromTitle = parseDomain(extractHttpUrl(pageTitle));
  if (fromTitle) {
    return { category: lookup("domain", fromTitle), source: "title-url", domain: fromTitle };
  }

  // 3. A site name the window title ends with ("… | GitHub").
  const cleanTitle = titleFromBrowserPageTitle(pageTitle, appName);
  const siteName = siteNameFromWindowTitle(cleanTitle);
  if (siteName) {
    return { category: lookup("domain", siteName), source: "title-site", domain: siteName };
  }

  // 4. No URL and no recognisable site name, but the cleaned window title may
  //    still have been classified by hand ("window_title" match type).
  if (cleanTitle) {
    const titleCategory = lookup("window_title", cleanTitle);
    if (titleCategory !== "unclassified") {
      return { category: titleCategory, source: "title-window", domain: cleanTitle };
    }
  }

  // 5. Nothing knowable about what was browsed - fall back to the browser
  //    itself rather than guessing. Honest, and matches pre-change behaviour.
  return { category: lookup("app", appName), source: "app", domain: "" };
}

export { isBrowserAppName };
