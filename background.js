// NewsAnchor background service worker.
// Fetches the Forex Factory weekly XML, parses it, caches into chrome.storage.local,
// refreshes hourly via chrome.alarms, and toggles the floating popup on icon click.

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const REFRESH_ALARM = "newsanchor-refresh";
const REFRESH_PERIOD_MIN = 60;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;   // trigger an opportunistic refresh on startup if cache is older
const COOLDOWN_MS = 30 * 1000;               // ignore manual refreshes within this window (return cached)
const RETRY_BACKOFF_MS = 1500;

const STORAGE_KEY = "ff_events";
const STORAGE_META_KEY = "ff_meta";
const STATE_KEY = "ui_state";

// Hoisted regexes — `g` flag means we reset .lastIndex before each scan.
const EVENT_RE = /<event>([\s\S]*?)<\/event>/g;
const FIELD_RE = /<(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
const DATE_RE = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(am|pm)$/i;

let inflight = null;
let lastSuccessAt = 0;

// ---- Listeners --------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); refreshIfStale(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); refreshIfStale(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refreshEvents().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "newsanchor:refresh") {
    refreshEvents()
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
});

// Toolbar icon click → message the active tab's content script. If we're not on
// a TradingView tab (no content script), flip the persisted state so the popup
// reflects the toggle whenever the user lands on a TV tab. Never opens a new tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "newsanchor:toggle" });
  } catch {
    const data = await chrome.storage.local.get(STATE_KEY);
    const cur = data[STATE_KEY] || {};
    await chrome.storage.local.set({ [STATE_KEY]: { ...cur, hidden: !cur.hidden } });
  }
});

// ---- Refresh pipeline -------------------------------------------------------

function ensureAlarm() {
  chrome.alarms.get(REFRESH_ALARM, (a) => {
    if (!a) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  });
}

async function refreshIfStale() {
  const { [STORAGE_META_KEY]: meta } = await chrome.storage.local.get(STORAGE_META_KEY);
  if (!meta || Date.now() - meta.fetchedAt > STALE_AFTER_MS) {
    refreshEvents().catch(() => {});
  }
}

// Single-flight + cooldown: spammed callers share the inflight fetch, then get
// cached data for COOLDOWN_MS so we don't hammer the Forex Factory CDN.
function refreshEvents() {
  if (inflight) return inflight;
  if (lastSuccessAt && Date.now() - lastSuccessAt < COOLDOWN_MS) {
    return chrome.storage.local.get(STORAGE_META_KEY).then((d) => ({
      meta: d[STORAGE_META_KEY] || null,
      cached: true,
    }));
  }
  inflight = (async () => {
    try {
      const events = await fetchWithRetry();
      const meta = { fetchedAt: Date.now(), count: events.length };
      await chrome.storage.local.set({ [STORAGE_KEY]: events, [STORAGE_META_KEY]: meta });
      lastSuccessAt = Date.now();
      return { meta, cached: false };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function fetchWithRetry() {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(FEED_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return parseFeed(await res.text());
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    }
  }
  throw lastErr;
}

// ---- XML parsing ------------------------------------------------------------
// DOMParser isn't available in MV3 service workers, so we parse with regexes.
// The Forex Factory feed is small (~25 KB, ~120 events), well-formed, and
// includes CDATA-wrapped date/time/impact/forecast/previous fields.

function parseFeed(xml) {
  const events = [];
  EVENT_RE.lastIndex = 0;
  let em;
  while ((em = EVENT_RE.exec(xml)) !== null) {
    const body = em[1];
    const obj = {};
    FIELD_RE.lastIndex = 0;
    let fm;
    while ((fm = FIELD_RE.exec(body)) !== null) obj[fm[1]] = (fm[2] || "").trim();
    events.push({
      title: obj.title || "",
      country: obj.country || "",
      date: obj.date || "",
      time: obj.time || "",
      impact: (obj.impact || "").toLowerCase(),
      forecast: obj.forecast || "",
      previous: obj.previous || "",
      url: obj.url || "",
      ts: parseEventDateTime(obj.date, obj.time),
    });
  }
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return events;
}

// Forex Factory XML times are US Eastern (with DST). Convert to a UTC epoch
// so the content script can render in the user's local timezone.
function parseEventDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const dm = dateStr.match(DATE_RE);
  if (!dm) return null;
  const tm = timeStr.match(TIME_RE);
  if (!tm) return null; // "All Day" / "Tentative"
  const month = +dm[1], day = +dm[2], year = +dm[3];
  let h = +tm[1];
  const min = +tm[2];
  const isPM = tm[3].toLowerCase() === "pm";
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  const offsetHours = isUSEastern_DST(year, month - 1, day) ? 4 : 5;
  return Date.UTC(year, month - 1, day, h + offsetHours, min);
}

function isUSEastern_DST(year, monthIdx, day) {
  if (monthIdx < 2 || monthIdx > 10) return false;
  if (monthIdx > 2 && monthIdx < 10) return true;
  if (monthIdx === 2) {
    const firstDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    return day >= ((7 - firstDow) % 7) + 1 + 7;
  }
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return day < ((7 - firstDow) % 7) + 1;
}
