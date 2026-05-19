# NewsAnchor — Privacy Policy

_Last updated: 2026-05-19_

NewsAnchor is a Chrome extension that displays Forex Factory economic
announcements relevant to the asset shown on a TradingView chart.

## Short version

- **No analytics. No telemetry. No third-party calls.**
- **No personal data is collected, transmitted, sold, or shared.** Ever.
- The only outbound network request the extension makes is a periodic
  `GET` to **`https://nfs.faireconomy.media/ff_calendar_thisweek.xml`** —
  the public, free, no-authentication weekly economic calendar feed
  published by Forex Factory. No identifiers are sent with the request.
- All user-facing data — your popup position, opacity, text size, filter
  state, and the cached event list — lives in `chrome.storage.local` on
  your own device. It never leaves your browser.

## What the extension processes locally

When you have a TradingView tab open, NewsAnchor's content script reads
the current chart's ticker symbol from the page URL (e.g. `?symbol=…`)
and, as a fallback, from a few specific DOM nodes (`data-symbol-short`,
`[data-name="legend-source-title"]`, `document.title`). That symbol is
used **in memory only** to filter the locally cached event list to the
relevant currencies. It is not stored, not transmitted, and not associated
with any identifier.

## What's stored locally (and only locally)

The following items live in `chrome.storage.local`:

| Key            | Contents                                                |
|----------------|---------------------------------------------------------|
| `ui_state`     | Popup position, size, opacity, text size, hidden state. |
| `impact_filter`| Which impact levels (High / Medium / Low / Holiday) are enabled. |
| `ff_events`    | The parsed array of events from the last successful XML fetch. |
| `ff_meta`      | `{ fetchedAt: <ms>, count: <int> }`.                    |

`chrome.storage.local` is sandboxed to the extension on your device.
NewsAnchor never reads this data back to a remote server.

## What's fetched from the network

A single resource, periodically:

- **URL:** `https://nfs.faireconomy.media/ff_calendar_thisweek.xml`
- **Method:** `GET`
- **Frequency:** once per hour via `chrome.alarms`, plus one manual
  refresh when you click the popup's ↻ button (rate-limited by a 30-
  second cooldown).
- **What's sent:** standard HTTP headers only — no identifiers, no
  cookies set by NewsAnchor, no symbol, no user data.
- **What's received:** an XML document containing this week's public
  economic events (title, country code, date, time, impact level,
  forecast, previous, source URL).

Forex Factory's own privacy practices are governed by their own
policies; consult <https://www.forexfactory.com> for details.

## Permissions and why each one is necessary

| Permission                       | Why                                                                                                  |
|----------------------------------|------------------------------------------------------------------------------------------------------|
| `storage`                        | Persist the popup's UI state and cache the event list locally.                                       |
| `alarms`                         | Schedule the hourly background refresh.                                                              |
| `activeTab`                      | Allow the toolbar icon click to message the content script and toggle the popup on the current tab. |
| Host `nfs.faireconomy.media`     | Fetch the Forex Factory weekly XML feed.                                                             |
| Content script on `tradingview.com` | Inject the floating popup on TradingView chart pages.                                             |

NewsAnchor requests no other permissions and contacts no other hosts.

## Data NewsAnchor does NOT collect

To be explicit:

- No personally identifiable information (name, email, address, age, ID).
- No health data.
- No financial information (transactions, card numbers, bank data,
  positions, portfolio, credit scores).
- No authentication data (passwords, tokens, secret questions).
- No personal communications.
- No location data (GPS, IP-based geolocation, region).
- No browsing history.
- No keystrokes, mouse movements, scroll positions, or other user
  activity telemetry.
- No website content beyond the ticker symbol read in memory (which is
  immediately discarded after filtering).

## Third parties

NewsAnchor has no third-party SDKs, no analytics, no advertising, no
crash reporting, no remote configuration, and no remote code execution
(all JavaScript and Wasm — if any — ship inside the extension package).

The only third-party network destination the extension contacts is the
Forex Factory public XML feed, which receives nothing about you beyond
the standard headers your browser sends for any HTTPS request.

## Changes to this policy

If this policy ever changes in a substantive way, the change will be
reflected in this file and the "Last updated" date at the top will be
bumped. The current version is always at
<https://github.com/flocom/NewsAnchor/blob/main/PRIVACY.md>.

## Contact

Questions, concerns or privacy-related reports:

- Open an issue at <https://github.com/flocom/NewsAnchor/issues>.

## Source

NewsAnchor is open-source under the MIT license. The full source of the
extension is at <https://github.com/flocom/NewsAnchor> — every behaviour
described above is auditable in the public repository.
