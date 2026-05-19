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
- **Impact filtering** (high / medium / low / holiday) with a colored dot per
  event.
- **Auto refresh** every hour via `chrome.alarms`. Manual refresh from the
  popup or the toolbar.
- Uses the free **[Forex Factory weekly XML feed](https://nfs.faireconomy.media/ff_calendar_thisweek.xml)**.
  No API key, no account.

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
background.js          Service worker: fetch + parse + cache Forex Factory XML
content/
  symbol-map.js        Ticker → currencies resolver (forex, indices, commodities, crypto, stocks)
  content.js           UI mount, symbol watcher, popup logic
  popup.css            Floating popup styles
popup/
  popup.html           Toolbar popup (settings/status)
  popup.css
  popup.js
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
