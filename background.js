// NewsAnchor background service worker
// - Fetches Forex Factory weekly XML calendar
// - Parses it (regex-based; DOMParser is unavailable in MV3 service workers)
// - Caches into chrome.storage.local
// - Refreshes every hour via chrome.alarms

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const REFRESH_ALARM = "newsanchor-refresh";
const REFRESH_PERIOD_MIN = 60;
const STORAGE_KEY = "ff_events";
const STORAGE_META_KEY = "ff_meta";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
  refreshEvents().catch((e) => console.warn("[NewsAnchor] initial fetch failed", e));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_PERIOD_MIN });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshEvents().catch((e) => console.warn("[NewsAnchor] refresh failed", e));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "newsanchor:getEvents") {
    chrome.storage.local.get([STORAGE_KEY, STORAGE_META_KEY], (data) => {
      sendResponse({
        events: data[STORAGE_KEY] || [],
        meta: data[STORAGE_META_KEY] || null,
      });
    });
    return true;
  }
  if (msg?.type === "newsanchor:refresh") {
    refreshEvents()
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

async function refreshEvents() {
  const res = await fetch(FEED_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const xml = await res.text();
  const events = parseFeed(xml);
  const meta = { fetchedAt: Date.now(), count: events.length };
  await chrome.storage.local.set({ [STORAGE_KEY]: events, [STORAGE_META_KEY]: meta });
  return meta;
}

function parseFeed(xml) {
  const events = [];
  const eventRe = /<event>([\s\S]*?)<\/event>/g;
  const fieldRe = /<(\w+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
  let em;
  while ((em = eventRe.exec(xml)) !== null) {
    const body = em[1];
    const obj = {};
    let fm;
    fieldRe.lastIndex = 0;
    while ((fm = fieldRe.exec(body)) !== null) {
      obj[fm[1]] = (fm[2] || "").trim();
    }
    const ts = parseEventDateTime(obj.date, obj.time);
    events.push({
      title: obj.title || "",
      country: obj.country || "",
      date: obj.date || "",
      time: obj.time || "",
      impact: (obj.impact || "").toLowerCase(),
      forecast: obj.forecast || "",
      previous: obj.previous || "",
      url: obj.url || "",
      ts,
    });
  }
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return events;
}

// Forex Factory XML feed is in US Eastern Time (with DST).
// Convert to a UTC epoch ms so the content script can render in user's locale.
function parseEventDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const dm = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!dm) return null;
  const month = parseInt(dm[1], 10);
  const day = parseInt(dm[2], 10);
  const year = parseInt(dm[3], 10);
  if (!timeStr) return null;
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!tm) return null; // "All Day", "Tentative", etc.
  let h = parseInt(tm[1], 10);
  const min = parseInt(tm[2], 10);
  const isPM = tm[3].toLowerCase() === "pm";
  if (isPM && h !== 12) h += 12;
  if (!isPM && h === 12) h = 0;
  const offsetHours = isUSEastern_DST(year, month - 1, day) ? 4 : 5;
  return Date.UTC(year, month - 1, day, h + offsetHours, min);
}

// US DST: from 2nd Sunday of March 02:00 local through 1st Sunday of November 02:00 local.
function isUSEastern_DST(year, monthIdx, day) {
  if (monthIdx < 2 || monthIdx > 10) return false;
  if (monthIdx > 2 && monthIdx < 10) return true;
  if (monthIdx === 2) {
    const firstDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
    const secondSunday = ((7 - firstDow) % 7) + 1 + 7;
    return day >= secondSunday;
  }
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstSunday = ((7 - firstDow) % 7) + 1;
  return day < firstSunday;
}
