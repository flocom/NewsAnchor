// NewsAnchor symbol → relevant currencies mapping.
// Loaded as a plain content script; attaches a global namespace.

(function () {
  "use strict";

  // ISO 4217 codes we recognise as "FX". The Forex Factory feed only emits a
  // subset (FF_TRACKED below), but knowing the broader set helps us classify
  // pairs even when no events are available.
  const FX_CODES = new Set([
    "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
    "CNY", "CNH", "HKD", "SGD", "SEK", "NOK", "DKK", "MXN",
    "ZAR", "TRY", "PLN", "HUF", "CZK", "RUB", "BRL", "INR",
    "KRW", "ILS", "THB",
  ]);

  const FF_TRACKED = new Set([
    "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNY",
  ]);

  // Stock / market-index → currency. Currency indices (DXY, EXY…) are also
  // here since they're treated like indices from the calendar's point of view.
  const INDEX_MAP = {
    // ---- Currency indices ------------------------------------------------
    DXY: ["USD"], USDX: ["USD"], USDIDX: ["USD"], USDIX: ["USD"],
    USDOLLAR: ["USD"], DOLLARINDEX: ["USD"], USDINDEX: ["USD"],
    EXY: ["EUR"], EURX: ["EUR"], EURIDX: ["EUR"], EURINDEX: ["EUR"],
    JXY: ["JPY"], JPYX: ["JPY"], JPYIDX: ["JPY"], JPYINDEX: ["JPY"],
    BXY: ["GBP"], GBPX: ["GBP"], GBPIDX: ["GBP"], GBPINDEX: ["GBP"],
    CXY: ["CAD"], CADX: ["CAD"], CADIDX: ["CAD"], CADINDEX: ["CAD"],
    AXY: ["AUD"], AUDX: ["AUD"], AUDIDX: ["AUD"], AUDINDEX: ["AUD"],
    SXY: ["CHF"], CHFX: ["CHF"], CHFIDX: ["CHF"], CHFINDEX: ["CHF"],
    ZXY: ["NZD"], NZDX: ["NZD"], NZDIDX: ["NZD"], NZDINDEX: ["NZD"],

    // ---- US equity indices ----------------------------------------------
    SPX: ["USD"], SPX500: ["USD"], US500: ["USD"], SP500: ["USD"], SPY: ["USD"],
    ES: ["USD"], MES: ["USD"], "ES1!": ["USD"], "MES1!": ["USD"],
    NAS100: ["USD"], NDX: ["USD"], NQ: ["USD"], "NQ1!": ["USD"], QQQ: ["USD"], USTEC: ["USD"], US100: ["USD"],
    DJI: ["USD"], DJ30: ["USD"], US30: ["USD"], YM: ["USD"], "YM1!": ["USD"], DIA: ["USD"], DJIA: ["USD"],
    RUT: ["USD"], RUSSELL: ["USD"], US2000: ["USD"], IWM: ["USD"], RTY: ["USD"],
    VIX: ["USD"], VXX: ["USD"], MOVE: ["USD"],

    // ---- Europe ---------------------------------------------------------
    DAX: ["EUR"], GER40: ["EUR"], DEU40: ["EUR"], GER30: ["EUR"], GDAXI: ["EUR"], DE40: ["EUR"], DE30: ["EUR"],
    CAC: ["EUR"], CAC40: ["EUR"], FR40: ["EUR"], FCHI: ["EUR"], FRA40: ["EUR"],
    STOXX50: ["EUR"], EU50: ["EUR"], SX5E: ["EUR"], STOXX50E: ["EUR"], EUSTX50: ["EUR"],
    IBEX: ["EUR"], ESP35: ["EUR"], SPA35: ["EUR"], IBX35: ["EUR"],
    AEX: ["EUR"], NL25: ["EUR"], NED25: ["EUR"],
    MIB: ["EUR"], FTSEMIB: ["EUR"], ITA40: ["EUR"], IT40: ["EUR"],
    BEL20: ["EUR"], BFX: ["EUR"],

    // ---- UK -------------------------------------------------------------
    FTSE: ["GBP"], FTSE100: ["GBP"], UK100: ["GBP"], UKX: ["GBP"], FTSE250: ["GBP"],

    // ---- Switzerland ----------------------------------------------------
    SMI: ["CHF"], SWI20: ["CHF"], SSMI: ["CHF"], CH20: ["CHF"],

    // ---- Japan ----------------------------------------------------------
    JP225: ["JPY"], NIKKEI: ["JPY"], NI225: ["JPY"], N225: ["JPY"], NK225: ["JPY"], TOPIX: ["JPY"],

    // ---- Australia / NZ -------------------------------------------------
    AUS200: ["AUD"], ASX200: ["AUD"], AXJO: ["AUD"], AU200: ["AUD"],
    NZ50: ["NZD"], NZD50: ["NZD"],

    // ---- Canada ---------------------------------------------------------
    TSX: ["CAD"], TSX60: ["CAD"], "S&P/TSX": ["CAD"], GSPTSE: ["CAD"], TSXCOMP: ["CAD"],

    // ---- China / HK -----------------------------------------------------
    HSI: ["CNY"], HK50: ["CNY"], HSI50: ["CNY"], HKHI: ["CNY"],
    CHINA50: ["CNY"], CSI300: ["CNY"], A50: ["CNY"], FTSECHINAA50: ["CNY"],
    HSCEI: ["CNY"], HSTECH: ["CNY"], SSEC: ["CNY"], SZSC: ["CNY"],
  };

  const COMMODITY_MAP = {
    // Precious metals
    GOLD: ["USD"], XAU: ["USD"], XAUUSD: ["USD"], GLD: ["USD"], GC: ["USD"],
    SILVER: ["USD"], XAG: ["USD"], XAGUSD: ["USD"], SLV: ["USD"], SI: ["USD"],
    PLATINUM: ["USD"], XPT: ["USD"], XPTUSD: ["USD"], PL: ["USD"],
    PALLADIUM: ["USD"], XPD: ["USD"], XPDUSD: ["USD"], PA: ["USD"],
    COPPER: ["USD"], HG: ["USD"], XCU: ["USD"],
    // Energy
    USOIL: ["USD"], WTI: ["USD"], WTICOUSD: ["USD"], CL: ["USD"], "CL1!": ["USD"], CRUDE: ["USD"],
    UKOIL: ["USD", "GBP"], BRENT: ["USD"], BCO: ["USD"], BCOUSD: ["USD"],
    NATGAS: ["USD"], NG: ["USD"], "NG1!": ["USD"], XNG: ["USD"], NGAS: ["USD"],
    HEATOIL: ["USD"], HO: ["USD"],
    GASOLINE: ["USD"], RB: ["USD"],
  };

  // Known crypto base tickers — extended periodically as the market shifts.
  const CRYPTO_BASES = new Set([
    "BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "DOT", "MATIC", "LINK",
    "AVAX", "LTC", "TRX", "XLM", "ATOM", "NEAR", "ETC", "FIL", "APT", "ARB",
    "OP", "TON", "SHIB", "PEPE", "SUI", "INJ", "TIA", "SEI", "RNDR", "FET",
    "ICP", "HBAR", "VET", "ALGO", "EGLD", "AAVE", "UNI", "MKR", "CRV", "LDO",
    "WIF", "BONK", "JTO", "ORDI", "RUNE", "GALA", "SAND", "MANA", "AXS",
    "TAO", "ENA", "PYTH", "JUP", "STRK", "POPCAT", "RAY", "FLOKI",
  ]);

  const CRYPTO_QUOTES = new Set(["USD", "USDT", "USDC", "USDD", "DAI", "BUSD", "TUSD", "FDUSD", "EUR"]);
  const STABLE_QUOTES = ["USDT", "USDC", "USDD", "BUSD", "TUSD", "FDUSD"];

  const EXCHANGE_COUNTRY = {
    NASDAQ: "USD", NYSE: "USD", AMEX: "USD", ARCA: "USD", BATS: "USD", OTC: "USD",
    CBOE: "USD", IEX: "USD",
    LSE: "GBP", LSEIOB: "GBP",
    XETR: "EUR", FWB: "EUR", TRADEGATE: "EUR", SWB: "EUR", BER: "EUR",
    EURONEXT: "EUR", PAR: "EUR", AMS: "EUR", BRU: "EUR", LIS: "EUR", MIL: "EUR",
    BME: "EUR", BVMF: "BRL",
    TSX: "CAD", TSXV: "CAD", NEO: "CAD", CSE: "CAD",
    ASX: "AUD",
    JPX: "JPY", TSE: "JPY",
    HKEX: "HKD", SEHK: "HKD", SSE: "CNY", SZSE: "CNY",
    KRX: "KRW",
    BIST: "TRY",
    MOEX: "RUB",
    SIX: "CHF",
    SGX: "SGD",
    NSE: "INR", BSE: "INR",
    TASE: "ILS",
  };

  // Pre-sort commodity keys by length (longest first) so prefix matching
  // picks the most specific entry — eg "XAUUSDT" matches "XAUUSD" before "XAU".
  const COMMODITY_KEYS = Object.keys(COMMODITY_MAP).sort((a, b) => b.length - a.length);
  const STABLE_QUOTES_SET = new Set(STABLE_QUOTES);
  const NORM_RE = /[._-]/g;
  const PERP_RE = /\bPERP\b/g;

  function stripPrefix(raw) {
    const colon = raw.lastIndexOf(":");
    return colon >= 0 ? raw.slice(colon + 1) : raw;
  }

  function normalize(raw) {
    return stripPrefix(String(raw || "").trim().toUpperCase())
      .replace(NORM_RE, "")
      .replace(PERP_RE, "")
      .replace(/!$/, "");
  }

  function exchangeOf(raw) {
    const s = String(raw || "");
    const colon = s.indexOf(":");
    return colon < 0 ? "" : s.slice(0, colon).toUpperCase();
  }

  function dedupe(arr) {
    return arr.length < 2 ? arr.slice() : Array.from(new Set(arr));
  }

  function resolve(rawTicker) {
    const sym = normalize(rawTicker);
    const exch = exchangeOf(rawTicker);

    // 1) Explicit commodity / index lookup first.
    if (COMMODITY_MAP[sym]) {
      return { type: "commodity", currencies: dedupe(COMMODITY_MAP[sym]), ticker: sym };
    }
    if (INDEX_MAP[sym]) {
      return { type: "index", currencies: dedupe(INDEX_MAP[sym]), ticker: sym };
    }

    // 2) Crypto: known base × stable/USD quote (or 2-5 char base × stable).
    const cryptoHit = matchCrypto(sym);
    if (cryptoHit) {
      return { type: "crypto", currencies: ["USD"], ticker: sym, base: cryptoHit.base, quote: cryptoHit.quote };
    }

    // 3) Pure 6-char forex pair.
    if (sym.length === 6) {
      const a = sym.slice(0, 3);
      const b = sym.slice(3, 6);
      if (FX_CODES.has(a) && FX_CODES.has(b)) {
        return { type: "forex", currencies: dedupe([a, b]), ticker: sym, base: a, quote: b };
      }
    }

    // 3b) Forex with a stable quote (eg EURUSDT on Binance).
    const fxStable = matchForexStable(sym);
    if (fxStable) {
      return { type: "forex", currencies: dedupe([fxStable.base, "USD"]), ticker: sym, ...fxStable };
    }

    // 4) Commodity-prefixed symbol (eg "GOLDUSD", "XAUUSDT").
    for (const k of COMMODITY_KEYS) {
      if (!sym.startsWith(k)) continue;
      const tail = sym.slice(k.length);
      if (tail === "" || FX_CODES.has(tail) || STABLE_QUOTES_SET.has(tail)) {
        return { type: "commodity", currencies: dedupe(COMMODITY_MAP[k]), ticker: sym };
      }
    }

    // 5) Stock fallback — derive currency from the exchange prefix.
    const country = EXCHANGE_COUNTRY[exch] || "USD";
    return { type: "stock", currencies: [country], ticker: sym, exchange: exch };
  }

  function matchForexStable(sym) {
    for (const q of STABLE_QUOTES) {
      if (!sym.endsWith(q) || sym.length <= q.length) continue;
      const base = sym.slice(0, sym.length - q.length);
      if (FX_CODES.has(base) && base !== "USD" && !CRYPTO_BASES.has(base)) {
        return { base, quote: q };
      }
    }
    return null;
  }

  function matchCrypto(sym) {
    for (const q of CRYPTO_QUOTES) {
      if (!sym.endsWith(q) || sym.length <= q.length) continue;
      const base = sym.slice(0, sym.length - q.length);
      // FX base with a non-crypto quote → real forex cross, not crypto.
      if (FX_CODES.has(base) && !CRYPTO_BASES.has(base)) return null;
      // Don't shadow tokenized indices / commodities.
      if (COMMODITY_MAP[base] || INDEX_MAP[base]) return null;
      if (CRYPTO_BASES.has(base) || base.length <= 5) return { base, quote: q };
    }
    return null;
  }

  function relevantTo(event, resolved) {
    return !!(resolved && event && event.country && resolved.currencies.includes(event.country));
  }

  window.NewsAnchorSymbol = { resolve, relevantTo, FF_TRACKED };
})();
