// NewsAnchor symbol → relevant currencies mapping.
// Loaded as a plain content script; attaches a global namespace.

(function () {
  "use strict";

  const FX_CODES = new Set([
    "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
    "CNY", "CNH", "HKD", "SGD", "SEK", "NOK", "DKK", "MXN",
    "ZAR", "TRY", "PLN", "HUF", "CZK", "RUB", "BRL", "INR",
    "KRW", "ILS", "THB",
  ]);

  // Forex Factory feed only emits a subset; cross-reference at filter time.
  const FF_TRACKED = new Set([
    "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNY",
  ]);

  const INDEX_MAP = {
    // US
    SPX: ["USD"], SPX500: ["USD"], US500: ["USD"], SP500: ["USD"], SPY: ["USD"],
    ES: ["USD"], MES: ["USD"], "ES1!": ["USD"], "MES1!": ["USD"],
    NAS100: ["USD"], NDX: ["USD"], NQ: ["USD"], "NQ1!": ["USD"], QQQ: ["USD"], USTEC: ["USD"],
    DJI: ["USD"], DJ30: ["USD"], US30: ["USD"], YM: ["USD"], "YM1!": ["USD"], DIA: ["USD"],
    RUT: ["USD"], RUSSELL: ["USD"], US2000: ["USD"], IWM: ["USD"], RTY: ["USD"],
    VIX: ["USD"],
    // EU
    DAX: ["EUR"], GER40: ["EUR"], DEU40: ["EUR"], GER30: ["EUR"], GDAXI: ["EUR"], DE40: ["EUR"], DE30: ["EUR"],
    CAC: ["EUR"], CAC40: ["EUR"], FR40: ["EUR"], FCHI: ["EUR"], FRA40: ["EUR"],
    STOXX50: ["EUR"], EU50: ["EUR"], SX5E: ["EUR"], "STOXX50E": ["EUR"],
    IBEX: ["EUR"], ESP35: ["EUR"], SPA35: ["EUR"],
    AEX: ["EUR"], NL25: ["EUR"], NED25: ["EUR"],
    MIB: ["EUR"], FTSEMIB: ["EUR"], ITA40: ["EUR"], IT40: ["EUR"],
    // UK
    FTSE: ["GBP"], FTSE100: ["GBP"], UK100: ["GBP"], UKX: ["GBP"],
    // CH
    SMI: ["CHF"], SWI20: ["CHF"], SSMI: ["CHF"],
    // JP
    JP225: ["JPY"], NIKKEI: ["JPY"], NI225: ["JPY"], N225: ["JPY"], "NK225": ["JPY"],
    // AU
    AUS200: ["AUD"], ASX200: ["AUD"], AXJO: ["AUD"], AU200: ["AUD"],
    // CA
    TSX: ["CAD"], TSX60: ["CAD"], "S&P/TSX": ["CAD"], GSPTSE: ["CAD"],
    // HK / CN
    HSI: ["CNY"], HK50: ["CNY"], HSI50: ["CNY"], HKHI: ["CNY"],
    CHINA50: ["CNY"], CSI300: ["CNY"], A50: ["CNY"], FTSECHINAA50: ["CNY"],
    // NZ
    NZ50: ["NZD"], NZD50: ["NZD"],
  };

  const COMMODITY_MAP = {
    GOLD: ["USD"], XAU: ["USD"], XAUUSD: ["USD"],
    SILVER: ["USD"], XAG: ["USD"], XAGUSD: ["USD"],
    PLATINUM: ["USD"], XPT: ["USD"], XPTUSD: ["USD"],
    PALLADIUM: ["USD"], XPD: ["USD"], XPDUSD: ["USD"],
    COPPER: ["USD"], HG: ["USD"],
    USOIL: ["USD"], WTI: ["USD"], WTICOUSD: ["USD"], CL: ["USD"], "CL1!": ["USD"],
    UKOIL: ["USD", "GBP"], BRENT: ["USD"], BCO: ["USD"], BCOUSD: ["USD"],
    NATGAS: ["USD"], NG: ["USD"], "NG1!": ["USD"], XNG: ["USD"],
  };

  // Crypto prefixes (asset side) → always USD macro
  const CRYPTO_BASES = new Set([
    "BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "DOT", "MATIC", "LINK",
    "AVAX", "LTC", "TRX", "XLM", "ATOM", "NEAR", "ETC", "FIL", "APT", "ARB",
    "OP", "TON", "SHIB", "PEPE", "SUI", "INJ", "TIA", "SEI", "RNDR", "FET",
    "ICP", "HBAR", "VET", "ALGO", "EGLD", "AAVE", "UNI", "MKR", "CRV", "LDO",
    "WIF", "BONK", "JTO", "ORDI", "RUNE", "GALA", "SAND", "MANA", "AXS",
  ]);

  const CRYPTO_QUOTES = new Set(["USD", "USDT", "USDC", "USDD", "DAI", "BUSD", "TUSD", "FDUSD", "EUR"]);

  // Exchange prefix → default currency (for stocks).
  const EXCHANGE_COUNTRY = {
    NASDAQ: "USD", NYSE: "USD", AMEX: "USD", ARCA: "USD", BATS: "USD", OTC: "USD",
    LSE: "GBP", LSEIOB: "GBP",
    XETR: "EUR", FWB: "EUR", TRADEGATE: "EUR", SWB: "EUR", BER: "EUR",
    EURONEXT: "EUR", AMEX_FR: "EUR", PAR: "EUR", AMS: "EUR", BRU: "EUR", LIS: "EUR", MIL: "EUR",
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

  function stripPrefix(raw) {
    if (!raw) return "";
    const colon = raw.lastIndexOf(":");
    return colon >= 0 ? raw.slice(colon + 1) : raw;
  }

  function normalize(raw) {
    return stripPrefix(String(raw || "").trim().toUpperCase())
      .replace(/[._-]/g, "")
      .replace(/\bPERP\b/g, "")
      .replace(/!$/, "");
  }

  function exchangeOf(raw) {
    const s = String(raw || "");
    const colon = s.indexOf(":");
    if (colon < 0) return "";
    return s.slice(0, colon).toUpperCase();
  }

  function resolve(rawTicker) {
    const sym = normalize(rawTicker);
    const exch = exchangeOf(rawTicker);

    // 1) Explicit indices / commodities lookup first (some look like forex, eg XAUUSD).
    if (COMMODITY_MAP[sym]) {
      return { type: "commodity", currencies: dedupe(COMMODITY_MAP[sym]), ticker: sym };
    }
    if (INDEX_MAP[sym]) {
      return { type: "index", currencies: dedupe(INDEX_MAP[sym]), ticker: sym };
    }

    // 2) Crypto pairs: <BASE><QUOTE> where BASE is a known crypto or QUOTE is a stable.
    const cryptoHit = matchCrypto(sym);
    if (cryptoHit) return { type: "crypto", currencies: ["USD"], ticker: sym, base: cryptoHit.base, quote: cryptoHit.quote };

    // 3) Pure forex: exactly 6 chars, both halves are FX codes.
    if (sym.length === 6) {
      const a = sym.slice(0, 3);
      const b = sym.slice(3, 6);
      if (FX_CODES.has(a) && FX_CODES.has(b)) {
        return { type: "forex", currencies: dedupe([a, b]), ticker: sym, base: a, quote: b };
      }
    }

    // 4) Index-like 7+ char with known commodity/index substring (eg "GOLDUSD").
    for (const [k, v] of Object.entries(COMMODITY_MAP)) {
      if (sym.startsWith(k) && (sym.length === k.length || FX_CODES.has(sym.slice(k.length)))) {
        return { type: "commodity", currencies: dedupe(v), ticker: sym };
      }
    }

    // 5) Stock: derive from exchange prefix; fallback USD.
    const country = EXCHANGE_COUNTRY[exch] || "USD";
    return { type: "stock", currencies: dedupe([country]), ticker: sym, exchange: exch };
  }

  function matchCrypto(sym) {
    for (const q of CRYPTO_QUOTES) {
      if (sym.endsWith(q) && sym.length > q.length) {
        const base = sym.slice(0, sym.length - q.length);
        if (CRYPTO_BASES.has(base) || base.length <= 5) {
          // Heuristic: 2-5 char base + stable quote → likely crypto, unless it's a known FX cross.
          if (FX_CODES.has(base) && FX_CODES.has(q) && q !== "USDT" && q !== "USDC") return null;
          return { base, quote: q };
        }
      }
    }
    return null;
  }

  function dedupe(arr) {
    return Array.from(new Set(arr));
  }

  function relevantTo(event, resolved) {
    if (!resolved || !event || !event.country) return false;
    return resolved.currencies.includes(event.country);
  }

  window.NewsAnchorSymbol = {
    resolve,
    relevantTo,
    FF_TRACKED,
  };
})();
