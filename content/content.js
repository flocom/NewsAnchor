// NewsAnchor content script (TradingView).
// Detects the current ticker, fetches events from the service worker,
// and renders a draggable popup with the relevant economic announcements.

(function () {
  "use strict";

  if (window.__newsanchorMounted) return;
  window.__newsanchorMounted = true;

  const STATE_KEY = "ui_state";
  const FILTER_KEY = "impact_filter";
  const DEFAULT_STATE = { x: null, y: null, w: 340, h: 420, minimized: false, hidden: false };
  const DEFAULT_FILTER = { high: true, medium: true, low: false, holiday: false };
  const IMPACT_RANK = { high: 3, medium: 2, low: 1, holiday: 0 };

  let state = { ...DEFAULT_STATE };
  let filter = { ...DEFAULT_FILTER };
  let events = [];
  let meta = null;
  let currentSymbol = null;
  let resolved = null;
  let root = null;

  init();

  async function init() {
    const stored = await chromeGet([STATE_KEY, FILTER_KEY]);
    if (stored[STATE_KEY]) state = { ...DEFAULT_STATE, ...stored[STATE_KEY] };
    if (stored[FILTER_KEY]) filter = { ...DEFAULT_FILTER, ...stored[FILTER_KEY] };

    buildPopup();
    applyState();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[FILTER_KEY]) {
        filter = { ...DEFAULT_FILTER, ...changes[FILTER_KEY].newValue };
        renderEvents();
      }
      if (changes[STATE_KEY]) {
        const next = { ...DEFAULT_STATE, ...changes[STATE_KEY].newValue };
        const wasHidden = state.hidden;
        state = next;
        applyState();
        if (wasHidden && !state.hidden) loadEvents();
      }
      if (changes.ff_events) {
        events = changes.ff_events.newValue || [];
        renderEvents();
      }
      if (changes.ff_meta) {
        meta = changes.ff_meta.newValue || null;
        renderFooter();
      }
    });

    watchSymbol();
    await loadEvents();
  }

  // ---- Symbol detection ------------------------------------------------------

  function watchSymbol() {
    const checkAndUpdate = () => {
      const sym = detectSymbol();
      if (sym && sym !== currentSymbol) {
        currentSymbol = sym;
        resolved = window.NewsAnchorSymbol.resolve(sym);
        renderHeader();
        renderEvents();
      }
    };

    checkAndUpdate();

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () { origPush.apply(this, arguments); setTimeout(checkAndUpdate, 50); };
    history.replaceState = function () { origReplace.apply(this, arguments); setTimeout(checkAndUpdate, 50); };
    window.addEventListener("popstate", checkAndUpdate);

    const titleObserver = new MutationObserver(checkAndUpdate);
    const titleEl = document.querySelector("title");
    if (titleEl) titleObserver.observe(titleEl, { childList: true });

    setInterval(checkAndUpdate, 1500);
  }

  function detectSymbol() {
    try {
      const u = new URL(location.href);
      const fromQuery = u.searchParams.get("symbol");
      if (fromQuery) return decodeURIComponent(fromQuery);

      const symMatch = u.pathname.match(/\/symbols\/([^/]+)\/?/i);
      if (symMatch) return decodeURIComponent(symMatch[1]).replace(/-/g, ":");
    } catch {}

    const legend = document.querySelector('[data-name="legend-source-title"]');
    if (legend && legend.textContent) return legend.textContent.trim();

    const dataSym = document.querySelector("[data-symbol]");
    if (dataSym) return dataSym.getAttribute("data-symbol");

    const titleMatch = document.title.match(/^([A-Z0-9.:_/-]+)/);
    if (titleMatch) return titleMatch[1];

    return null;
  }

  // ---- Data ------------------------------------------------------------------

  async function loadEvents() {
    const resp = await sendMessage({ type: "newsanchor:getEvents" });
    if (resp) {
      events = resp.events || [];
      meta = resp.meta || null;
    }
    renderEvents();
    renderFooter();

    if (!events.length || !meta || Date.now() - meta.fetchedAt > 4 * 3600 * 1000) {
      refresh();
    }
  }

  async function refresh() {
    setStatus("Mise à jour…");
    const resp = await sendMessage({ type: "newsanchor:refresh" });
    if (resp && resp.ok) {
      const data = await chromeGet(["ff_events", "ff_meta"]);
      events = data.ff_events || [];
      meta = data.ff_meta || null;
      renderEvents();
      renderFooter();
    } else {
      setStatus("Erreur de mise à jour");
    }
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
          <button class="newsanchor-btn" data-action="filter" title="Filtres d'impact">⚙</button>
          <button class="newsanchor-btn" data-action="refresh" title="Rafraîchir">↻</button>
          <button class="newsanchor-btn" data-action="minimize" title="Réduire">—</button>
          <button class="newsanchor-btn" data-action="close" title="Fermer">×</button>
        </div>
      </div>
      <div class="newsanchor-filters" hidden>
        <label><input type="checkbox" data-impact="high" /> <span class="dot dot-high"></span> Haut</label>
        <label><input type="checkbox" data-impact="medium" /> <span class="dot dot-medium"></span> Moyen</label>
        <label><input type="checkbox" data-impact="low" /> <span class="dot dot-low"></span> Bas</label>
        <label><input type="checkbox" data-impact="holiday" /> <span class="dot dot-holiday"></span> Fériés</label>
      </div>
      <div class="newsanchor-body">
        <div class="newsanchor-currencies"></div>
        <ul class="newsanchor-events"></ul>
        <div class="newsanchor-empty" hidden>Aucun événement à venir pour cet actif.</div>
      </div>
      <div class="newsanchor-footer">
        <span class="newsanchor-status"></span>
        <a class="newsanchor-credit" href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">Forex Factory</a>
      </div>
      <div class="newsanchor-resize" data-resize-handle></div>
    `;
    document.documentElement.appendChild(root);

    root.querySelectorAll(".newsanchor-actions .newsanchor-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.getAttribute("data-action");
        if (action === "close") setHidden(true);
        else if (action === "minimize") toggleMinimized();
        else if (action === "refresh") refresh();
        else if (action === "filter") toggleFilters();
      });
    });

    root.querySelectorAll(".newsanchor-filters input[type=checkbox]").forEach((cb) => {
      const key = cb.getAttribute("data-impact");
      cb.checked = !!filter[key];
      cb.addEventListener("change", () => {
        filter = { ...filter, [key]: cb.checked };
        chrome.storage.local.set({ [FILTER_KEY]: filter });
        renderEvents();
      });
    });

    enableDrag(root, root.querySelector("[data-drag-handle]"));
    enableResize(root, root.querySelector("[data-resize-handle]"));
  }

  function applyState() {
    if (!root) return;
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
    root.style.display = state.hidden ? "none" : "flex";
  }

  // ---- Rendering -------------------------------------------------------------

  function renderHeader() {
    if (!root) return;
    const tickerEl = root.querySelector(".newsanchor-ticker");
    const badgeEl = root.querySelector(".newsanchor-badge");
    tickerEl.textContent = resolved?.ticker || currentSymbol || "—";
    badgeEl.textContent = resolved ? resolved.type.toUpperCase() : "";
    badgeEl.setAttribute("data-type", resolved?.type || "");
  }

  function renderEvents() {
    if (!root) return;
    const list = root.querySelector(".newsanchor-events");
    const empty = root.querySelector(".newsanchor-empty");
    const ccyEl = root.querySelector(".newsanchor-currencies");

    if (!resolved) {
      list.innerHTML = "";
      empty.hidden = false;
      empty.textContent = "Ticker non détecté.";
      ccyEl.textContent = "";
      return;
    }

    ccyEl.innerHTML = resolved.currencies
      .map((c) => `<span class="cc">${escapeHtml(c)}</span>`)
      .join("");

    const now = Date.now();
    const filtered = events.filter((e) => {
      const matchCountry = e.country === "All" || resolved.currencies.includes(e.country);
      if (!matchCountry) return false;
      if (!filter[e.impact]) return false;
      if (e.ts && e.ts < now - 60 * 60 * 1000) return false;
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = "";
      empty.hidden = false;
      empty.textContent = events.length
        ? "Aucun événement à venir pour cet actif cette semaine."
        : "Chargement…";
      return;
    }
    empty.hidden = true;
    list.innerHTML = filtered.map(renderEvent).join("");
  }

  function renderEvent(ev) {
    const when = ev.ts
      ? new Date(ev.ts).toLocaleString(undefined, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : `${ev.date} ${ev.time || ""}`.trim();
    const impactClass = `dot-${ev.impact || "low"}`;
    const values = [];
    if (ev.previous) values.push(`<span class="prev">Préc <b>${escapeHtml(ev.previous)}</b></span>`);
    if (ev.forecast) values.push(`<span class="fcst">Prév <b>${escapeHtml(ev.forecast)}</b></span>`);
    const url = ev.url ? `<a class="ext" href="${escapeAttr(ev.url)}" target="_blank" rel="noopener">↗</a>` : "";
    return `
      <li class="newsanchor-event" data-impact="${escapeAttr(ev.impact)}">
        <div class="ev-time">${escapeHtml(when)}</div>
        <div class="ev-row">
          <span class="dot ${impactClass}" title="${escapeAttr(ev.impact || "")}"></span>
          <span class="ev-country">${escapeHtml(ev.country)}</span>
          <span class="ev-title">${escapeHtml(ev.title)}</span>
          ${url}
        </div>
        ${values.length ? `<div class="ev-values">${values.join("")}</div>` : ""}
      </li>
    `;
  }

  function renderFooter() {
    if (!root) return;
    if (!meta) { setStatus(""); return; }
    const d = new Date(meta.fetchedAt);
    setStatus(`MAJ ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · ${meta.count} events`);
  }

  function setStatus(s) {
    const el = root && root.querySelector(".newsanchor-status");
    if (el) el.textContent = s;
  }

  // ---- Actions ---------------------------------------------------------------

  function toggleFilters() {
    const f = root.querySelector(".newsanchor-filters");
    f.hidden = !f.hidden;
  }

  function toggleMinimized() {
    state = { ...state, minimized: !state.minimized };
    chrome.storage.local.set({ [STATE_KEY]: state });
    applyState();
  }

  function setHidden(h) {
    state = { ...state, hidden: !!h };
    chrome.storage.local.set({ [STATE_KEY]: state });
    applyState();
  }

  // ---- Drag & resize ---------------------------------------------------------

  function enableDrag(el, handle) {
    let startX, startY, origX, origY, dragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".newsanchor-actions")) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origX = rect.left;
      origY = rect.top;
      el.classList.add("is-dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = origX + (e.clientX - startX);
      const y = origY + (e.clientY - startY);
      el.style.left = clampX(x) + "px";
      el.style.top = clampY(y) + "px";
      el.style.right = "auto";
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      const rect = el.getBoundingClientRect();
      state = { ...state, x: rect.left, y: rect.top };
      chrome.storage.local.set({ [STATE_KEY]: state });
    });
  }

  function enableResize(el, handle) {
    let startX, startY, startW, startH, resizing = false;
    handle.addEventListener("mousedown", (e) => {
      resizing = true;
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const w = Math.max(260, startW + (e.clientX - startX));
      const h = Math.max(180, startH + (e.clientY - startY));
      el.style.width = w + "px";
      el.style.height = h + "px";
    });
    window.addEventListener("mouseup", () => {
      if (!resizing) return;
      resizing = false;
      const rect = el.getBoundingClientRect();
      state = { ...state, w: Math.round(rect.width), h: Math.round(rect.height) };
      chrome.storage.local.set({ [STATE_KEY]: state });
    });
  }

  function clampX(x) {
    const max = Math.max(0, window.innerWidth - 200);
    return Math.min(Math.max(0, x), max);
  }
  function clampY(y) {
    const max = Math.max(0, window.innerHeight - 80);
    return Math.min(Math.max(0, y), max);
  }

  // ---- Helpers ---------------------------------------------------------------

  function chromeGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }
  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(resp);
        });
      } catch { resolve(null); }
    });
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
