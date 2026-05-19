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
  const DEFAULT_STATE = { x: null, y: null, w: 360, h: 460, minimized: false, hidden: false };
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
      syncFilterCheckboxes();
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
      const sym = detectSymbol();
      if (sym === currentSymbol) return;
      currentSymbol = sym;
      resolved = sym ? window.NewsAnchorSymbol.resolve(sym) : null;
      currencies = new Set(resolved?.currencies || []);
      renderHeader();
      renderEvents();
      applyState();
      attachLegendObserver(); // legend element may have just appeared
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
    const tick = () => {
      const sym = detectSymbol();
      if (sym && sym !== currentSymbol) {
        currentSymbol = sym;
        resolved = window.NewsAnchorSymbol.resolve(sym);
        currencies = new Set(resolved?.currencies || []);
        renderHeader();
        renderEvents();
        applyState();
      }
    };
    legendObserver = new MutationObserver(tick);
    legendObserver._target = legend;
    legendObserver.observe(legend, { childList: true, subtree: true, characterData: true });
  }

  const LEGEND_SELECTOR = [
    '[data-name="legend-source-title"]',
    '[data-name="legend-series-item"] [data-name*="title"]',
    '.chart-markup-table [class*="symbolName"]',
    '[class*="mainTitle"]',
  ].join(",");

  function detectSymbol() {
    try {
      const u = new URL(location.href);
      const fromQuery = u.searchParams.get("symbol");
      if (fromQuery) return decodeURIComponent(fromQuery);
      const symMatch = u.pathname.match(/\/symbols\/([^/]+)\/?/i);
      if (symMatch) return decodeURIComponent(symMatch[1]).replace(/-/g, ":");
    } catch {}

    const legend = document.querySelector(LEGEND_SELECTOR);
    if (legend?.textContent) {
      const t = legend.textContent.trim();
      if (t && t.length < 40) return t;
    }

    const dataSym = document.querySelector("[data-symbol]");
    if (dataSym) return dataSym.getAttribute("data-symbol");

    const titleMatch = document.title.match(/^([A-Z0-9.:_/-]+)/);
    return titleMatch ? titleMatch[1] : null;
  }

  // ---- Data refresh ----------------------------------------------------------

  async function refresh() {
    setStatus("Mise à jour…");
    const resp = await sendMessage({ type: "newsanchor:refresh" });
    if (!resp?.ok) setStatus("Erreur de mise à jour");
    // Success: storage.onChanged triggers renderEvents/renderFooter.
  }

  // ---- DOM construction ------------------------------------------------------

  function buildPopup() {
    root = document.createElement("div");
    root.id = "newsanchor-root";
    root.className = "newsanchor-root";
    root.innerHTML = `
      <div class="newsanchor-header" data-drag-handle>
        <div class="newsanchor-title">
          <span class="newsanchor-logo">📡</span>
          <span class="newsanchor-ticker">—</span>
          <span class="newsanchor-badge"></span>
        </div>
        <div class="newsanchor-actions">
          <button type="button" class="newsanchor-btn" data-action="filter" title="Filtres d'impact" aria-label="Filtres">⚙</button>
          <button type="button" class="newsanchor-btn" data-action="refresh" title="Rafraîchir" aria-label="Rafraîchir">↻</button>
          <button type="button" class="newsanchor-btn" data-action="minimize" title="Réduire" aria-label="Réduire">_</button>
          <button type="button" class="newsanchor-btn" data-action="close" title="Fermer" aria-label="Fermer">×</button>
        </div>
      </div>
      <div class="newsanchor-filters is-collapsed">
        <label><input type="checkbox" data-impact="high" /><span class="dot dot-high"></span><span>Haut</span></label>
        <label><input type="checkbox" data-impact="medium" /><span class="dot dot-medium"></span><span>Moyen</span></label>
        <label><input type="checkbox" data-impact="low" /><span class="dot dot-low"></span><span>Bas</span></label>
        <label><input type="checkbox" data-impact="holiday" /><span class="dot dot-holiday"></span><span>Fériés</span></label>
      </div>
      <div class="newsanchor-body">
        <div class="newsanchor-currencies"></div>
        <ul class="newsanchor-events"></ul>
        <div class="newsanchor-empty"></div>
      </div>
      <div class="newsanchor-footer">
        <span class="newsanchor-status"></span>
        <span class="newsanchor-tz" title="Heures affichées dans le fuseau horaire du navigateur">${escapeHtml(TZ_ABBR)}</span>
      </div>
      <div class="newsanchor-resize" data-resize-handle></div>
    `;
    (document.body || document.documentElement).appendChild(root);

    root.querySelector(".newsanchor-actions").addEventListener("click", (e) => {
      const btn = e.target.closest(".newsanchor-btn");
      if (!btn) return;
      e.stopPropagation();
      switch (btn.getAttribute("data-action")) {
        case "close":     saveState({ hidden: true }); break;
        case "minimize":  saveState({ minimized: !state.minimized }); break;
        case "refresh":   refresh(); break;
        case "filter":    toggleFilters(); break;
      }
    });

    syncFilterCheckboxes();
    root.querySelector(".newsanchor-filters").addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-impact]');
      if (!cb) return;
      filter = { ...filter, [cb.getAttribute("data-impact")]: cb.checked };
      chrome.storage.local.set({ [FILTER_KEY]: filter });
      renderEvents();
    });

    enableDrag(root, root.querySelector("[data-drag-handle]"));
    enableResize(root, root.querySelector("[data-resize-handle]"));
  }

  function syncFilterCheckboxes() {
    if (!root) return;
    root.querySelectorAll('.newsanchor-filters input[data-impact]').forEach((cb) => {
      cb.checked = !!filter[cb.getAttribute("data-impact")];
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
    const badgeEl = root.querySelector(".newsanchor-badge");
    badgeEl.textContent = resolved ? resolved.type.toUpperCase() : "";
    badgeEl.setAttribute("data-type", resolved?.type || "");
  }

  function renderEvents() {
    if (!root) return;
    const list = root.querySelector(".newsanchor-events");
    const empty = root.querySelector(".newsanchor-empty");
    const ccyEl = root.querySelector(".newsanchor-currencies");

    if (!resolved) {
      list.textContent = "";
      ccyEl.textContent = "";
      empty.hidden = false;
      empty.textContent = "Ticker non détecté.";
      return;
    }

    ccyEl.innerHTML = resolved.currencies
      .map((c) => `<span class="cc">${escapeHtml(c)}</span>`).join("");

    const cutoff = Date.now() - 60 * 60 * 1000;
    const filtered = events.filter((e) =>
      (e.country === "All" || currencies.has(e.country)) &&
      filter[e.impact] &&
      (!e.ts || e.ts >= cutoff)
    );

    if (!filtered.length) {
      list.textContent = "";
      empty.hidden = false;
      empty.textContent = events.length
        ? "Aucun événement à venir pour cet actif cette semaine."
        : "Chargement…";
      return;
    }
    empty.hidden = true;
    list.innerHTML = renderGroups(filtered);
  }

  function renderGroups(filtered) {
    const groups = new Map();
    for (const ev of filtered) {
      const key = ev.ts
        ? new Date(ev.ts).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })
        : ev.date || "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    return [...groups.entries()].map(([day, evs]) => `
      <li class="newsanchor-day">
        <div class="day-label">${escapeHtml(day)}</div>
        <ul class="day-events">${evs.map(renderEvent).join("")}</ul>
      </li>
    `).join("");
  }

  function renderEvent(ev) {
    const when = ev.ts
      ? new Date(ev.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : (ev.time || "—");
    const values = [];
    if (ev.previous) values.push(`<span class="prev"><i>Préc</i> <b>${escapeHtml(ev.previous)}</b></span>`);
    if (ev.forecast) values.push(`<span class="fcst"><i>Prév</i> <b>${escapeHtml(ev.forecast)}</b></span>`);
    const url = ev.url
      ? `<a class="ext" href="${escapeHtml(ev.url)}" target="_blank" rel="noopener" title="Voir sur Forex Factory">↗</a>` : "";
    const impact = ev.impact || "low";
    return `
      <li class="newsanchor-event" data-impact="${escapeHtml(impact)}">
        <div class="ev-time">${escapeHtml(when)}</div>
        <div class="ev-main">
          <div class="ev-row">
            <span class="dot dot-${escapeHtml(impact)}" title="${escapeHtml(impact)}"></span>
            <span class="ev-country">${escapeHtml(ev.country)}</span>
            <span class="ev-title">${escapeHtml(ev.title)}</span>
            ${url}
          </div>
          ${values.length ? `<div class="ev-values">${values.join("")}</div>` : ""}
        </div>
      </li>
    `;
  }

  function renderFooter() {
    if (!root) return;
    if (!meta) return setStatus("Aucune donnée");
    const d = new Date(meta.fetchedAt);
    const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    setStatus(`MAJ ${time} · ${meta.count} events`);
  }

  function setStatus(s) {
    const el = root && root.querySelector(".newsanchor-status");
    if (el) el.textContent = s;
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
        el.style.width = Math.max(280, startW + (lastEvent.clientX - startX)) + "px";
        el.style.height = Math.max(200, startH + (lastEvent.clientY - startY)) + "px";
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
