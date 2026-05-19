// NewsAnchor background service worker.
// Fetches the Forex Factory weekly XML, parses it, caches into chrome.storage.local,
// refreshes hourly via chrome.alarms, and toggles the floating popup on icon click.

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const REFRESH_ALARM = "newsanchor-refresh";
const REFRESH_PERIOD_MIN = 60;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "ff_events";
const STORAGE_META_KEY = "ff_meta";
const STATE_KEY = "ui_state";

let inflight = null;
let lastSuccessAt = 0;
const COOLDOWN_MS = 30 * 1000;

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
    return true;
  }
});

// Toggling the floating popup directly when the user clicks the toolbar icon.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  const url = tab.url || "";
  if (!/^https:\/\/[^/]*tradingview\.com\//.test(url)) {
    chrome.tabs.create({ url: "https://www.tradingview.com/chart/" });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "newsanchor:toggle" });
  } catch {
    // Content script not yet injected (eg right after install) → fall back to storage flip.
    const data = await chrome.storage.local.get(STATE_KEY);
    const cur = data[STATE_KEY] || {};
    await chrome.storage.local.set({ [STATE_KEY]: { ...cur, hidden: !cur.hidden } });
  }
});

function ensureAlarm() {
  chrome.alarms.get(REFRESH_ALARM, (a) => {
    if (!a) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  });
}

async function refreshIfStale() {
  const data = await chrome.storage.local.get(STORAGE_META_KEY);
  const meta = data[STORAGE_META_KEY];
  if (!meta || Date.now() - meta.fetchedAt > STALE_AFTER_MS) {
    refreshEvents().catch(() => {});
  }
}

// Single-flight + cooldown: spammed clicks share the inflight fetch, then return
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
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

function parseFeed(xml) {
  const events = [];
  const eventRe = /<event>([\s\S]*?)<\/event>/g;
  const fieldRe = /<(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
  let em;
  while ((em = eventRe.exec(xml)) !== null) {
    const body = em[1];
    const obj = {};
    fieldRe.lastIndex = 0;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) obj[fm[1]] = (fm[2] || "").trim();
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

// Forex Factory XML is published in US Eastern Time (with DST).
// We convert to a UTC epoch so the content script can render in the user's locale.
function parseEventDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const dm = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!dm) return null;
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
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
