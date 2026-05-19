const STATE_KEY = "ui_state";
const FILTER_KEY = "impact_filter";
const DEFAULT_FILTER = { high: true, medium: true, low: false, holiday: false };

const lastFetchEl = document.getElementById("last-fetch");
const eventCountEl = document.getElementById("event-count");
const refreshBtn = document.getElementById("refresh");
const togglePopupBtn = document.getElementById("toggle-popup");
const resetBtn = document.getElementById("reset-position");

init();

async function init() {
  const data = await chromeGet(["ff_meta", "ff_events", FILTER_KEY]);
  renderStatus(data.ff_meta, data.ff_events);
  applyFilters({ ...DEFAULT_FILTER, ...(data[FILTER_KEY] || {}) });

  document.querySelectorAll('.filters input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", async () => {
      const stored = await chromeGet([FILTER_KEY]);
      const cur = { ...DEFAULT_FILTER, ...(stored[FILTER_KEY] || {}) };
      cur[cb.getAttribute("data-impact")] = cb.checked;
      chrome.storage.local.set({ [FILTER_KEY]: cur });
    });
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Mise à jour…";
    const resp = await sendMessage({ type: "newsanchor:refresh" });
    if (resp && resp.ok) {
      const data = await chromeGet(["ff_meta", "ff_events"]);
      renderStatus(data.ff_meta, data.ff_events);
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻ Rafraîchir le calendrier";
  });

  togglePopupBtn.addEventListener("click", async () => {
    const stored = await chromeGet([STATE_KEY]);
    const s = stored[STATE_KEY] || {};
    chrome.storage.local.set({ [STATE_KEY]: { ...s, hidden: !s.hidden } });
  });

  resetBtn.addEventListener("click", async () => {
    const stored = await chromeGet([STATE_KEY]);
    const s = stored[STATE_KEY] || {};
    chrome.storage.local.set({
      [STATE_KEY]: { ...s, x: null, y: null, w: 340, h: 420, minimized: false, hidden: false },
    });
  });
}

function renderStatus(meta, events) {
  if (meta) {
    const d = new Date(meta.fetchedAt);
    lastFetchEl.textContent = d.toLocaleString(undefined, {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } else {
    lastFetchEl.textContent = "Jamais";
  }
  eventCountEl.textContent = (events && events.length) ? String(events.length) : "0";
}

function applyFilters(filter) {
  document.querySelectorAll('.filters input[type="checkbox"]').forEach((cb) => {
    cb.checked = !!filter[cb.getAttribute("data-impact")];
  });
}

function chromeGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(r);
      });
    } catch { resolve(null); }
  });
}
