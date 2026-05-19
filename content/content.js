// NewsAnchor content script (TradingView).
// Detects the current ticker, reads cached events from chrome.storage.local,
// and renders a draggable popup with the relevant economic announcements.

(function () {
  "use strict";

  if (window.__newsanchorMounted) return;
  window.__newsanchorMounted = true;

  const STATE_KEY = "ui_state";
  const FILTER_KEY = "impact_filter";
  const EVENTS_KEY = "ff_events";
  const META_KEY = "ff_meta";
  const DEFAULT_STATE = { x: null, y: null, w: 280, h: 360, minimized: false, hidden: false };
  const DEFAULT_FILTER = { high: true, medium: true, low: false, holiday: false };

  let state = { ...DEFAULT_STATE };
  let filter = { ...DEFAULT_FILTER };
  let events = [];
  let meta = null;
  let currentSymbol = null;
  let resolved = null;
  let currencies = new Set();
  let root = null;
  let legendObserver = null;

  // The browser's local TZ abbreviation (used in the footer for clarity).
  const TZ_ABBR = (() => {
    try {
      const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName");
      return part ? part.value : "";
    } catch { return ""; }
  })();

  init();

  async function init() {
    loadFonts();

    const stored = await chromeGet([STATE_KEY, FILTER_KEY, EVENTS_KEY, META_KEY]);
    if (stored[STATE_KEY]) state = { ...DEFAULT_STATE, ...stored[STATE_KEY] };
    if (stored[FILTER_KEY]) filter = { ...DEFAULT_FILTER, ...stored[FILTER_KEY] };
    events = stored[EVENTS_KEY] || [];
    meta = stored[META_KEY] || null;

    buildPopup();
    applyState();
    renderFooter();

    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onMessage);
    window.addEventListener("resize", onWindowResize, { passive: true });

    watchSymbol();

    if (!events.length || !meta || Date.now() - meta.fetchedAt > 4 * 3600 * 1000) {
      refresh();
    }
  }

  function loadFonts() {
    if (!("FontFace" in window) || !chrome.runtime?.getURL) return;
    const faces = [
      ["400", "fonts/Inter-Regular.woff2"],
      ["600", "fonts/Inter-SemiBold.woff2"],
    ];
    Promise.all(
      faces.map(([weight, path]) => {
        const url = chrome.runtime.getURL(path);
        const ff = new FontFace("NewsAnchorInter", `url(${url}) format("woff2")`, {
          weight, style: "normal", display: "swap",
        });
        return ff.load().then((loaded) => document.fonts.add(loaded)).catch(() => null);
      })
    );
  }

  function onMessage(msg, _sender, _sendResponse) {
    if (msg?.type === "newsanchor:toggle") {
      saveState({ hidden: !state.hidden });
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes[FILTER_KEY]) {
      filter = { ...DEFAULT_FILTER, ...changes[FILTER_KEY].newValue };
      syncFilterPills();
      renderEvents();
    }
    if (changes[STATE_KEY]) {
      state = { ...DEFAULT_STATE, ...changes[STATE_KEY].newValue };
      applyState();
    }
    if (changes[EVENTS_KEY]) {
      events = changes[EVENTS_KEY].newValue || [];
      renderEvents();
    }
    if (changes[META_KEY]) {
      meta = changes[META_KEY].newValue || null;
      renderFooter();
    }
  }

  // ---- Symbol detection ------------------------------------------------------

  function watchSymbol() {
    const tick = () => {
      if (document.hidden) return;
      const raw = detectSymbol();
      const result = resolveWithRecovery(raw);
      const effective = result?.ticker || raw;
      if (effective === currentSymbol) return;
      currentSymbol = effective;
      resolved = result;
      currencies = new Set(resolved?.currencies || []);
      renderHeader();
      renderEvents();
      applyState();
      attachLegendObserver();
    };

    tick();

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () { origPush.apply(this, arguments); queueMicrotask(tick); };
    history.replaceState = function () { origReplace.apply(this, arguments); queueMicrotask(tick); };
    window.addEventListener("popstate", tick);

    const titleEl = document.querySelector("title");
    if (titleEl) new MutationObserver(tick).observe(titleEl, { childList: true });

    attachLegendObserver();
    // 1 Hz fallback. Cheap (5 DOM queries) and reattaches the legend observer
    // when TradingView replaces the header on a symbol switch from the watchlist.
    setInterval(() => {
      if (document.hidden) return;
      if (!legendObserver?._target?.isConnected) attachLegendObserver();
      tick();
    }, 1000);
  }

  function attachLegendObserver() {
    const legend = document.querySelector(LEGEND_SELECTOR);
    if (!legend || legendObserver?._target === legend) return;
    legendObserver?.disconnect();
    legendObserver = new MutationObserver(updateFromDom);
    legendObserver._target = legend;
    legendObserver.observe(legend, { childList: true, subtree: true, characterData: true });
  }

  function updateFromDom() {
    if (document.hidden) return;
    const raw = detectSymbol();
    const result = resolveWithRecovery(raw);
    const effective = result?.ticker || raw;
    if (effective === currentSymbol) return;
    currentSymbol = effective;
    resolved = result;
    currencies = new Set(resolved?.currencies || []);
    renderHeader();
    renderEvents();
    applyState();
  }

  // Resolve a raw ticker string, with a fallback when TradingView's DOM prepends
  // a single-letter badge ("EGBPAUD" → "GBPAUD"). Triggers only when removing
  // the leading char produces a strictly cleaner classification.
  function resolveWithRecovery(raw) {
    if (!raw) return null;
    const orig = window.NewsAnchorSymbol.resolve(raw);
    if (raw.includes(":")) return orig;
    const norm = raw.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (norm.length !== 7) return orig;
    const stripped = window.NewsAnchorSymbol.resolve(norm.slice(1));
    // Stripping reveals a clean 6-char forex pair → strong signal.
    if (stripped.type === "forex" && stripped.ticker.length === 6) return stripped;
    // Stripping promotes an unknown stock to a recognized asset type.
    if (orig.type === "stock" && stripped.type !== "stock") return stripped;
    return orig;
  }

  const LEGEND_SELECTOR = [
    '[data-name="legend-source-title"]',
    '[data-name="legend-series-item"] [data-name*="title"]',
    '[class*="mainTitle"]',
  ].join(",");
  const SYMBOL_RE = /([A-Z][A-Z0-9_]{1,10}:[A-Z0-9._]{2,15}|[A-Z][A-Z0-9._]{2,11})/;

  function detectSymbol() {
    // 1) URL — the most reliable when present.
    try {
      const u = new URL(location.href);
      const fromQuery = u.searchParams.get("symbol");
      if (fromQuery) return decodeURIComponent(fromQuery);
      const pathSym = u.pathname.match(/\/symbols\/([^/]+)\/?/i);
      if (pathSym) return decodeURIComponent(pathSym[1]).replace(/-/g, ":");
    } catch {}

    // 2) Dedicated attributes (cleaner than scraping text).
    const shortAttr = document.querySelector("[data-symbol-short]");
    if (shortAttr) {
      const v = shortAttr.getAttribute("data-symbol-short");
      if (v && v.length < 40) return v;
    }

    // 3) Legend element. Strip icons (SVG / aria-hidden) and extract a clean token.
    const legend = document.querySelector(LEGEND_SELECTOR);
    const txt = visibleText(legend);
    if (txt) {
      const m = txt.match(SYMBOL_RE);
      if (m) return m[1];
      if (txt.length < 30) return txt;
    }

    // 4) Generic data-symbol (less reliable: watchlist rows also expose it).
    const dataSym = document.querySelector("[data-symbol]");
    if (dataSym) return dataSym.getAttribute("data-symbol");

    // 5) document.title (eg "AAPL Chart Image — TradingView").
    const titleMatch = document.title.match(SYMBOL_RE);
    return titleMatch ? titleMatch[1] : null;
  }

  const SKIP_TAGS = new Set(["SVG", "PATH", "USE", "IMG", "CIRCLE", "RECT", "G", "DEFS"]);
  function visibleText(el) {
    if (!el) return "";
    const parts = [];
    const queue = [el];
    while (queue.length) {
      const n = queue.shift();
      if (!n) continue;
      if (n.nodeType === 3) { parts.push(n.textContent); continue; }
      if (n.nodeType !== 1) continue;
      if (SKIP_TAGS.has(n.tagName)) continue;
      if (n.getAttribute && n.getAttribute("aria-hidden") === "true") continue;
      for (const c of n.childNodes) queue.push(c);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  // ---- Data refresh ----------------------------------------------------------

  async function refresh() {
    const btn = root?.querySelector('.newsanchor-btn[data-action="refresh"]');
    btn?.classList.add("is-loading");
    const resp = await sendMessage({ type: "newsanchor:refresh" });
    btn?.classList.remove("is-loading");
    if (!resp) return;
    if (resp.ok && resp.cached) showToast("Calendrier déjà à jour");
    else if (!resp.ok) showToast("Calendrier indisponible");
    else renderFooter(); // refresh tooltip
  }

  let toastTimer = 0;
  function showToast(msg) {
    if (!root) return;
    let toast = root.querySelector(".newsanchor-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "newsanchor-toast";
      root.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  // ---- DOM construction ------------------------------------------------------

  function buildPopup() {
    root = document.createElement("div");
    root.id = "newsanchor-root";
    root.className = "newsanchor-root";
    root.innerHTML = `
      <div class="newsanchor-header" data-drag-handle>
        <div class="newsanchor-title">
          <span class="newsanchor-ticker">—</span>
          <span class="newsanchor-ccy"></span>
        </div>
        <div class="newsanchor-actions">
          <button type="button" class="newsanchor-btn" data-action="filter" title="Filtres" aria-label="Filtres">⚙</button>
          <button type="button" class="newsanchor-btn" data-action="refresh" title="Rafraîchir — MAJ ${escapeHtml(TZ_ABBR)}" aria-label="Rafraîchir">↻</button>
          <button type="button" class="newsanchor-btn" data-action="close" title="Fermer" aria-label="Fermer">×</button>
        </div>
      </div>
      <div class="newsanchor-filters is-collapsed">
        <button type="button" class="newsanchor-pill" data-impact="high" title="Impact élevé" aria-label="Impact élevé"><span class="dot dot-high"></span></button>
        <button type="button" class="newsanchor-pill" data-impact="medium" title="Impact moyen" aria-label="Impact moyen"><span class="dot dot-medium"></span></button>
        <button type="button" class="newsanchor-pill" data-impact="low" title="Impact bas" aria-label="Impact bas"><span class="dot dot-low"></span></button>
        <button type="button" class="newsanchor-pill" data-impact="holiday" title="Jours fériés" aria-label="Jours fériés"><span class="dot dot-holiday"></span></button>
      </div>
      <div class="newsanchor-body">
        <ul class="newsanchor-events"></ul>
        <div class="newsanchor-empty"></div>
      </div>
      <div class="newsanchor-resize" data-resize-handle></div>
    `;
    (document.body || document.documentElement).appendChild(root);

    root.querySelector(".newsanchor-actions").addEventListener("click", (e) => {
      const btn = e.target.closest(".newsanchor-btn");
      if (!btn) return;
      e.stopPropagation();
      switch (btn.getAttribute("data-action")) {
        case "close":   saveState({ hidden: true }); break;
        case "refresh": refresh(); break;
        case "filter":  toggleFilters(); break;
      }
    });
    // Double-click the header to collapse to a minimal strip.
    root.querySelector(".newsanchor-header").addEventListener("dblclick", (e) => {
      if (e.target.closest(".newsanchor-actions")) return;
      saveState({ minimized: !state.minimized });
    });

    syncFilterPills();
    root.querySelector(".newsanchor-filters").addEventListener("click", (e) => {
      const pill = e.target.closest(".newsanchor-pill[data-impact]");
      if (!pill) return;
      e.stopPropagation();
      const key = pill.getAttribute("data-impact");
      filter = { ...filter, [key]: !filter[key] };
      chrome.storage.local.set({ [FILTER_KEY]: filter });
      syncFilterPills();
      renderEvents();
    });

    enableDrag(root, root.querySelector("[data-drag-handle]"));
    enableResize(root, root.querySelector("[data-resize-handle]"));
  }

  function syncFilterPills() {
    if (!root) return;
    root.querySelectorAll(".newsanchor-pill[data-impact]").forEach((pill) => {
      pill.classList.toggle("is-active", !!filter[pill.getAttribute("data-impact")]);
    });
  }

  function applyState() {
    if (!root) return;
    const visible = !state.hidden && !!currentSymbol;
    root.style.display = visible ? "flex" : "none";
    if (!visible) return;

    if (state.x == null || state.y == null) {
      root.style.right = "16px";
      root.style.top = "84px";
      root.style.left = "auto";
    } else {
      root.style.left = clampX(state.x) + "px";
      root.style.top = clampY(state.y) + "px";
      root.style.right = "auto";
    }
    root.style.width = (state.w || DEFAULT_STATE.w) + "px";
    root.style.height = state.minimized ? "auto" : (state.h || DEFAULT_STATE.h) + "px";
    root.classList.toggle("is-minimized", !!state.minimized);
  }

  function onWindowResize() {
    if (!root || state.x == null || state.y == null) return;
    root.style.left = clampX(state.x) + "px";
    root.style.top = clampY(state.y) + "px";
  }

  // ---- Rendering -------------------------------------------------------------

  function renderHeader() {
    if (!root) return;
    root.querySelector(".newsanchor-ticker").textContent = resolved?.ticker || currentSymbol || "—";
    root.querySelector(".newsanchor-ccy").textContent =
      resolved ? resolved.currencies.join(" · ") : "";
  }

  function renderEvents() {
    if (!root) return;
    const list = root.querySelector(".newsanchor-events");
    const empty = root.querySelector(".newsanchor-empty");

    if (!resolved) {
      list.textContent = "";
      empty.hidden = false;
      empty.textContent = "Ticker non détecté";
      return;
    }

    const cutoff = Date.now() - 60 * 60 * 1000;
    const filtered = events.filter((e) =>
      (e.country === "All" || currencies.has(e.country)) &&
      filter[e.impact] &&
      (!e.ts || e.ts >= cutoff)
    );

    if (!filtered.length) {
      list.textContent = "";
      empty.hidden = false;
      empty.textContent = events.length ? "Aucun événement à venir" : "Chargement…";
      return;
    }
    empty.hidden = true;
    list.innerHTML = renderGroups(filtered);
  }

  function renderGroups(filtered) {
    const groups = new Map();
    for (const ev of filtered) {
      const key = ev.ts ? dayKey(ev.ts) : (ev.date || "—");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const today = dayKey(Date.now());
    const tomorrow = dayKey(Date.now() + 86400_000);
    return [...groups.entries()].map(([key, evs]) => {
      const sample = evs[0]?.ts;
      let label, cls = "";
      if (key === today) { label = "aujourd'hui"; cls = "is-today"; }
      else if (key === tomorrow) { label = "demain"; cls = "is-tomorrow"; }
      else if (sample) {
        label = new Date(sample).toLocaleDateString(undefined, {
          weekday: "short", day: "numeric", month: "short",
        });
      } else {
        label = evs[0]?.date || "—";
      }
      return `
        <li class="newsanchor-day ${cls}">
          <div class="day-label">${escapeHtml(label)}</div>
          <ul class="day-events">${evs.map(renderEvent).join("")}</ul>
        </li>
      `;
    }).join("");
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function renderEvent(ev) {
    const when = ev.ts
      ? new Date(ev.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
      : (ev.time || "—");
    const impact = ev.impact || "low";
    const values = formatValues(ev.previous, ev.forecast);
    return `
      <li class="newsanchor-event" data-impact="${escapeHtml(impact)}">
        <div class="ev-time">${escapeHtml(when)}</div>
        <div class="ev-content">
          <div class="ev-row">
            <span class="dot dot-${escapeHtml(impact)}"></span>
            <span class="ev-country">${escapeHtml(ev.country)}</span>
            <span class="ev-title">${escapeHtml(ev.title)}</span>
          </div>
          ${values ? `<div class="ev-values">${values}</div>` : ""}
        </div>
      </li>
    `;
  }

  function formatValues(prev, fcst) {
    prev = (prev || "").trim();
    fcst = (fcst || "").trim();
    if (prev && fcst) return `${escapeHtml(prev)}<span class="ev-arrow">→</span>${escapeHtml(fcst)}`;
    if (prev) return escapeHtml(prev);
    if (fcst) return `<span class="ev-arrow">→</span>${escapeHtml(fcst)}`;
    return "";
  }

  // No permanent status bar — the refresh button's tooltip carries the last-fetch
  // time so we never spend pixels on idle status.
  function renderFooter() {
    if (!root) return;
    const btn = root.querySelector('.newsanchor-btn[data-action="refresh"]');
    if (!btn) return;
    if (!meta) { btn.title = "Rafraîchir"; return; }
    const time = new Date(meta.fetchedAt).toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    btn.title = `Rafraîchir — MAJ ${time}${TZ_ABBR ? " " + TZ_ABBR : ""}`;
  }

  // ---- Actions ---------------------------------------------------------------

  function toggleFilters() {
    const f = root.querySelector(".newsanchor-filters");
    f.classList.toggle("is-collapsed");
  }

  function saveState(patch) {
    state = { ...state, ...patch };
    chrome.storage.local.set({ [STATE_KEY]: state });
    applyState();
  }

  // ---- Drag & resize ---------------------------------------------------------

  function enableDrag(el, handle) {
    let startX, startY, origX, origY, raf = 0, lastEvent = null;

    const onMove = (e) => {
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!lastEvent) return;
        el.style.left = clampX(origX + (lastEvent.clientX - startX)) + "px";
        el.style.top = clampY(origY + (lastEvent.clientY - startY)) + "px";
        el.style.right = "auto";
        lastEvent = null;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      el.classList.remove("is-dragging");
      const rect = el.getBoundingClientRect();
      saveState({ x: Math.round(rect.left), y: Math.round(rect.top) });
    };
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".newsanchor-actions")) return;
      const rect = el.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      origX = rect.left;  origY = rect.top;
      el.classList.add("is-dragging");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      e.preventDefault();
    });
  }

  function enableResize(el, handle) {
    let startX, startY, startW, startH, raf = 0, lastEvent = null;

    const onMove = (e) => {
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!lastEvent) return;
        el.style.width = Math.max(240, startW + (lastEvent.clientX - startX)) + "px";
        el.style.height = Math.max(160, startH + (lastEvent.clientY - startY)) + "px";
        lastEvent = null;
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      const rect = el.getBoundingClientRect();
      saveState({ w: Math.round(rect.width), h: Math.round(rect.height) });
    };
    handle.addEventListener("mousedown", (e) => {
      const rect = el.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startW = rect.width; startH = rect.height;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function clampX(x) { return Math.min(Math.max(0, x), Math.max(0, window.innerWidth - 200)); }
  function clampY(y) { return Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 80)); }

  // ---- Helpers ---------------------------------------------------------------

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
  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }
})();
