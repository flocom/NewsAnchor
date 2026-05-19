<div align="center">

<img src="icons/icon128.png" width="96" alt="NewsAnchor icon" />

# NewsAnchor

**Economic announcements, anchored to the asset you're charting.**

A minimal Chrome extension that floats a draggable popup over TradingView and
shows the upcoming Forex Factory events relevant to whatever symbol is on
your screen — forex pairs, indices, commodities, crypto and stocks.

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
![Version](https://img.shields.io/badge/version-0.3.0-orange?style=flat-square)

</div>

---

## Features

- **Asset-aware filtering** — the popup resolves the TradingView ticker on the
  page and only shows events that move *that* market:
  - Forex pairs → both legs (`EURUSD` → EUR + USD)
  - Indices → country currency (`DAX` → EUR, `NAS100` → USD, `JP225` → JPY)
  - Commodities → USD (`XAUUSD`, `USOIL`, …)
  - Crypto → USD macro (`BTCUSDT`, `ETHUSD`, …)
  - Stocks → exchange currency (`NASDAQ:AAPL` → USD, `TSX:SHOP` → CAD)
- **Live ticker tracking** — patched `history.pushState`, a title observer,
  a legend `MutationObserver` and a 1 Hz fallback keep the popup in sync
  even when you switch symbols via the watchlist.
- **Draggable, resizable, minimizable** — the entire popup is freely
  positioned and persisted across reloads. Double-click the top strip to
  collapse to a tiny dock.
- **Today, distinct** — today's events sit in a full-bleed blue card with a
  solid left accent bar. Tomorrow gets its own subdued label; later days
  fade further.
- **Real settings** — gear icon opens a panel with:
  - Impact filter pills (High / Medium / Low / Holiday)
  - Text size (S / M / L) — every element scales from a single root size
  - Opacity slider (40–100 %) so the popup can blend over the chart
- **Click-through to source** — every event row links to its Forex Factory
  page; middle-click opens in a new tab.
- **Hover-revealed chrome** — the gear, refresh and close icons stay
  invisible until you hover the popup, so the resting state is just data.
- **Cooldown-aware refresh** — clicking ↻ during the 30 s post-fetch
  cooldown returns cached data with a soft *Calendar up to date* toast,
  never re-hitting the Forex Factory CDN.
- **Self-contained typography** — Inter (Regular + SemiBold, latin subset,
  ~44 KB total) ships inside the extension. Identical rendering on Mac /
  Windows / Linux.

## Install

### From source (developer mode)

1. Clone the repo:
   ```bash
   git clone https://github.com/flocom/NewsAnchor.git
   ```
2. Open `chrome://extensions/`, toggle **Developer mode** (top-right).
3. Click **Load unpacked** and pick the cloned folder.
4. Open any TradingView chart — the popup appears in the top-right corner.

### From a release asset

Download `newsanchor-v0.3.0.zip` from the
[Releases page](https://github.com/flocom/NewsAnchor/releases), unzip, then
follow steps 2–4 above.

### Chrome Web Store

*Coming soon.*

## How it works

```
┌──────────────────────┐         ┌───────────────────┐
│  Forex Factory XML   │  hourly │  Service worker   │
│  (US Eastern, DST)   │  ──────▶│  fetch + parse +  │
└──────────────────────┘         │  cache in storage │
                                 └─────────┬─────────┘
                                           │  storage.onChanged
                                           ▼
┌──────────────────────┐         ┌───────────────────┐
│  TradingView chart   │   live  │   Content script  │
│  (symbol watcher)    │  ──────▶│   filter + render │
└──────────────────────┘         │   draggable popup │
                                 └───────────────────┘
```

- The service worker fetches
  [`ff_calendar_thisweek.xml`](https://nfs.faireconomy.media/ff_calendar_thisweek.xml)
  once an hour through `chrome.alarms`, with single-flight deduplication
  and a single retry on transient errors.
- Times in the XML are US Eastern (with DST). The service worker converts
  each event to a UTC epoch so the content script can render in your
  browser's local timezone (the TZ abbreviation appears in the refresh
  tooltip).
- The content script resolves the TradingView symbol from the URL first
  (`?symbol=…`), then from explicit data attributes
  (`[data-symbol-short]`), then from the chart legend with icon nodes
  stripped, then from the document title. A small recovery step strips a
  stray leading character if the resolution falls through to a generic
  stock (this fixes cases like `EGBPAUD` → `GBPAUD`).
- Symbol resolution maps the ticker to the relevant Forex Factory country
  codes; the floating popup filters and groups by day.

## Permissions & privacy

| Permission                       | Why |
|----------------------------------|-----|
| `storage`                        | Persist popup position, size, opacity, text size, filters and the cached event list (all local; never sent anywhere). |
| `alarms`                         | Schedule the hourly background refresh. |
| `activeTab`                      | Required so clicking the toolbar icon can message the content script to toggle the popup on the current TradingView tab. |
| `host: nfs.faireconomy.media`    | Fetch the Forex Factory weekly XML feed. |
| `content_scripts: tradingview.com` | Inject the popup on TradingView pages. |

**No analytics, no telemetry, no third-party calls** beyond the single XML
endpoint above. Nothing leaves your browser apart from the GET request to
Forex Factory's static feed.

## Repo layout

```
manifest.json          MV3 manifest
background.js          Service worker: fetch + parse + cache + icon toggle
content/
  symbol-map.js        Ticker → currencies resolver (forex, indices, …)
  content.js           UI mount, symbol watcher, popup logic, font loader
  popup.css            Floating popup styles (Inter, em-based scaling)
fonts/                 Inter Regular + SemiBold, latin subset (WOFF2)
icons/                 16 / 48 / 128 PNG icons
```

No build step. Edit the files, click **Reload** in `chrome://extensions/`.

## Building the Chrome Web Store package

```bash
zip -r dist/newsanchor-v0.3.0.zip \
  manifest.json background.js content fonts icons LICENSE \
  -x "*.DS_Store"
```

The resulting archive (~95 KB) is what gets uploaded to the
[Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole/).

## License

MIT — see [LICENSE](LICENSE).
