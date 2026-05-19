# NewsAnchor

Chrome extension that overlays a draggable, persistent popup on TradingView
showing the upcoming economic announcements relevant to the asset currently
displayed on the chart.

![icon](icons/icon128.png)

## Features

- **Auto-detects the current TradingView symbol** (URL + DOM fallbacks) and
  follows symbol changes live as you switch charts.
- **Maps the symbol to the right currencies**:
  - Forex pairs → both currencies (e.g. `EURUSD` → EUR + USD events)
  - Indices → country currency (e.g. `DAX` → EUR, `NAS100` → USD)
  - Commodities → USD (e.g. `XAUUSD`, `USOIL`)
  - Crypto → USD (e.g. `BTCUSDT`, `ETHUSD`)
  - Stocks → exchange currency (e.g. `NASDAQ:AAPL` → USD)
- **Draggable, resizable, minimizable** floating popup. Position is persisted
  across reloads.
- **Click the toolbar icon to toggle** the floating popup on the current
  TradingView tab. No separate settings window.
- **Impact filtering** (high / medium / low / holiday) with a colored dot per
  event. Events are grouped by day with sticky day headers.
- **Auto refresh** every hour via `chrome.alarms`, with single-flight
  deduplication and one retry on transient network errors.
- Embedded **Inter** font for clean, consistent typography across OSes.
- Uses the free **[Forex Factory weekly XML feed](https://nfs.faireconomy.media/ff_calendar_thisweek.xml)**.
  No API key, no account.

## Timezones

Three timezones are involved; here is exactly how they're handled:

| Where | Timezone |
|---|---|
| Forex Factory XML feed | US Eastern (EST / EDT) — converted by the service worker |
| NewsAnchor popup | Your **browser / OS** local timezone (the abbreviation is shown in the footer) |
| TradingView chart | Whatever you've configured in TradingView's bottom-right TZ selector (independent) |

If your TradingView is set to UTC but your OS is on CET, an event labeled
`14:30 CET` in NewsAnchor lines up with the `13:30 UTC` candle on the chart.

## Install (developer mode)

1. Clone:
   ```bash
   git clone https://github.com/flocom/NewsAnchor.git
   ```
2. Open `chrome://extensions/`.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and pick the cloned folder.
5. Open `tradingview.com` and a chart. The NewsAnchor popup appears in the
   top-right corner.

## File layout

```
manifest.json          MV3 manifest
background.js          Service worker: fetch + parse + cache + icon-click toggle
content/
  symbol-map.js        Ticker → currencies resolver (forex, indices, commodities, crypto, stocks)
  content.js           UI mount, symbol watcher, popup logic, font loader
  popup.css            Floating popup styles
fonts/                 Inter Regular + SemiBold (WOFF2, latin subset)
icons/                 16/48/128 PNG icons
```

## Notes

- Forex Factory's weekly XML is published in US Eastern Time (with DST). The
  service worker converts each event to a UTC epoch so the popup displays the
  event in the user's local timezone.
- Tradingview symbols arrive in many shapes (`EURUSD`, `FX:EURUSD`,
  `NASDAQ:AAPL`, `BINANCE:BTCUSDT`, `XAUUSD`, etc.). The resolver in
  `content/symbol-map.js` strips the exchange prefix and tries: explicit
  index/commodity lookup → crypto pair detection → pure forex pair → stock by
  exchange.
- The popup is scoped under `#newsanchor-root` and uses `all: initial` plus a
  very high `z-index` to avoid clashing with TradingView's own UI.

## Development

There is no build step. Edit the files in place and click **Reload** in
`chrome://extensions/` (or use a hot-reload helper if you prefer).

## License

MIT
