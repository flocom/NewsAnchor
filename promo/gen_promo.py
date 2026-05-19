#!/usr/bin/env python3
"""Generate NewsAnchor promo tiles + screenshots for the Chrome Web Store."""
import os, random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = "/Users/valentinhalgand/dev/NewsAnchor"
OUT = f"{ROOT}/promo"
os.makedirs(OUT, exist_ok=True)
random.seed(42)

FONT_DIR = "/tmp/inter_ttf/extras/ttf"

# ---- Color palette (matches the extension) ---------------------------------
BG = (19, 23, 34)
BG2 = (28, 32, 48)
PANEL = (24, 28, 41)
BORDER = (255, 255, 255, 18)
WHITE = (255, 255, 255)
TEXT = (232, 235, 240)
TEXT_DIM = (209, 212, 220)
MUTED = (179, 184, 194)
DIM = (138, 144, 160)
DIMMER = (90, 96, 112)
BLUE = (41, 98, 255)
BLUE_TINT = (41, 98, 255, 32)
RED = (242, 54, 69)
ORANGE = (255, 152, 0)
GREEN = (76, 175, 80)
SLATE = (96, 125, 139)

def font(size, weight="Regular"):
    return ImageFont.truetype(f"{FONT_DIR}/Inter-{weight}.ttf", size)

def vgrad(img, c1, c2):
    w, h = img.size
    base = Image.new("RGB", (1, h), c1)
    pix = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        pix[0, y] = (
            int(c1[0] + t * (c2[0] - c1[0])),
            int(c1[1] + t * (c2[1] - c1[1])),
            int(c1[2] + t * (c2[2] - c1[2])),
        )
    img.paste(base.resize((w, h), Image.NEAREST))

def rounded(d, xy, r, fill, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)

def text(img, xy, s, f, fill):
    """Draw text supporting RGBA by compositing."""
    if len(fill) == 4:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).text(xy, s, font=f, fill=fill)
        img.paste(layer, (0, 0), layer)
    else:
        ImageDraw.Draw(img).text(xy, s, font=f, fill=fill)

def rect_overlay(img, xy, fill_rgba):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(xy, fill=fill_rgba)
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB") if img.mode == "RGB" else Image.alpha_composite(img, layer)

# ---- Candlestick chart background ------------------------------------------

def draw_chart(img, x, y, w, h, seed=1):
    """Generate a plausible candlestick chart on the given area."""
    rng = random.Random(seed)
    d = ImageDraw.Draw(img)
    # Grid
    for i in range(1, 8):
        gy = y + i * h // 8
        d.line([(x, gy), (x + w, gy)], fill=(28, 32, 48), width=1)
    for i in range(1, 14):
        gx = x + i * w // 14
        d.line([(gx, y), (gx, y + h)], fill=(28, 32, 48), width=1)

    candle_w = 11
    gap = 5
    n = w // (candle_w + gap)
    price = 1.0850
    series = []
    for _ in range(n):
        o = price
        change = rng.gauss(0, 0.0015)
        c = o + change
        hi = max(o, c) + abs(rng.gauss(0, 0.0008))
        lo = min(o, c) - abs(rng.gauss(0, 0.0008))
        series.append((o, hi, lo, c))
        price = c

    lo_all = min(s[2] for s in series)
    hi_all = max(s[1] for s in series)
    pad = (hi_all - lo_all) * 0.1
    lo_all -= pad
    hi_all += pad
    span = hi_all - lo_all

    def py(p):
        return int(y + (1 - (p - lo_all) / span) * h)

    # Optional MA line
    if n > 10:
        ma = []
        for i in range(n):
            window = series[max(0, i - 9):i + 1]
            ma.append(sum(s[3] for s in window) / len(window))
        pts = []
        for i, p in enumerate(ma):
            cx = x + i * (candle_w + gap) + candle_w // 2
            pts.append((cx, py(p)))
        d.line(pts, fill=(95, 168, 224, 180), width=2)

    # Candles
    for i, (o, hi, lo, c) in enumerate(series):
        cx = x + i * (candle_w + gap)
        up = c >= o
        col = (76, 175, 80) if up else (242, 54, 69)
        wick_x = cx + candle_w // 2
        d.line([(wick_x, py(hi)), (wick_x, py(lo))], fill=col, width=1)
        body_top = py(max(o, c))
        body_bot = py(min(o, c))
        if body_bot - body_top < 2:
            body_bot = body_top + 2
        d.rectangle([cx, body_top, cx + candle_w - 1, body_bot], fill=col)

    # Faint right-side price scale
    for ty in range(0, 5):
        py_ = y + ty * h // 4
        p = hi_all - (hi_all - lo_all) * ty / 4
        d.text((x + w + 10, py_ - 8), f"{p:.4f}", font=font(11), fill=(111, 117, 133))


# ---- Popup mockup ----------------------------------------------------------

EVENTS_TODAY = [
    ("14:30", "high", "USD", "Non-Farm Employment Change", "+150K", "+180K"),
    ("14:30", "medium", "USD", "Unemployment Rate", "4.1%", "4.0%"),
    ("16:00", "low", "EUR", "Consumer Confidence", "-14.0", "-13.5"),
]
EVENTS_TOMORROW = [
    ("01:30", "high", "USD", "FOMC Meeting Minutes", "", ""),
    ("13:00", "medium", "GBP", "BOE Gov Bailey Speaks", "", ""),
]
EVENTS_LATER = [
    ("08:00", "medium", "EUR", "German Flash Manufacturing PMI", "44.6", "44.8"),
    ("13:30", "high", "USD", "Core PCE Price Index m/m", "0.3%", "0.2%"),
]


def draw_popup(img, x, y, scale=1.0, show_actions=False, show_settings=False, symbol_label="GBPAUD"):
    """Render the NewsAnchor popup mock at (x, y). scale > 1 for promo tiles."""
    w = int(280 * scale)
    h = int(360 * scale)
    s = scale
    d = ImageDraw.Draw(img, "RGBA")

    # Drop shadow
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([x + 4, y + 12, x + w + 4, y + h + 12], radius=int(8 * s), fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(18 * s)))
    img.paste(shadow, (0, 0), shadow)

    # Popup body
    rounded(d, [x, y, x + w, y + h], int(8 * s), fill=BG, outline=(255, 255, 255, 18), width=1)

    # Body padding
    pad_x = int(9 * s)
    cur_y = y + int(8 * s)  # below the (invisible) drag strip

    # Today card (blue tint, full bleed, left accent bar)
    today_h = int(8 * s) + int(22 * s) + len(EVENTS_TODAY) * int(34 * s)  # approx
    today_top = cur_y
    today_bottom = today_top + today_h
    # tint
    tint = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(tint).rectangle([x + 1, today_top, x + w - 1, today_bottom], fill=(41, 98, 255, 28))
    img.paste(tint, (0, 0), tint)
    # left accent bar (3px)
    d.rectangle([x + 1, today_top, x + 1 + int(3 * s), today_bottom], fill=BLUE)
    # inner top/bottom 1px highlight
    d.line([(x + 1, today_top), (x + w - 1, today_top)], fill=(41, 98, 255, 60))

    # today label
    label_x = x + pad_x + int(8 * s)
    label_y = today_top + int(7 * s)
    text(img, (label_x, label_y), "today", font(int(11 * s), "Bold"), TEXT)

    # today events
    ev_y = label_y + int(22 * s)
    for t, imp, ctry, title, prev, fcst in EVENTS_TODAY:
        _draw_event(img, x + pad_x + int(6 * s), ev_y, w - pad_x * 2 - int(6 * s), t, imp, ctry, title, prev, fcst, scale=s, bright=True)
        ev_y += int(34 * s)

    # tomorrow section
    tom_y = ev_y + int(6 * s)
    text(img, (x + pad_x, tom_y + int(2 * s)), "tomorrow", font(int(10 * s), "SemiBold"), MUTED)
    ev_y = tom_y + int(20 * s)
    for t, imp, ctry, title, prev, fcst in EVENTS_TOMORROW:
        _draw_event(img, x + pad_x, ev_y, w - pad_x * 2, t, imp, ctry, title, prev, fcst, scale=s, bright=False)
        ev_y += int(30 * s)

    # later day section (if it fits)
    if ev_y + int(40 * s) < y + h - int(8 * s) and EVENTS_LATER:
        later_y = ev_y + int(4 * s)
        text(img, (x + pad_x, later_y + int(2 * s)), "thu, may 21", font(int(10 * s), "SemiBold"), DIMMER)
        ev_y = later_y + int(20 * s)
        for t, imp, ctry, title, prev, fcst in EVENTS_LATER:
            if ev_y + int(28 * s) > y + h - int(8 * s):
                break
            _draw_event(img, x + pad_x, ev_y, w - pad_x * 2, t, imp, ctry, title, prev, fcst, scale=s, bright=False, very_faded=True)
            ev_y += int(30 * s)

    # Action chip (visible only when show_actions)
    if show_actions:
        icon_w = int(28 * s)
        icons = ["⚙", "↻", "×"]
        chip_w = icon_w * len(icons) + int(8 * s)
        chip_h = int(28 * s)
        chip_x = x + w - chip_w - int(5 * s)
        chip_y = y + int(4 * s)
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [chip_x, chip_y, chip_x + chip_w, chip_y + chip_h],
            radius=int(6 * s), fill=(19, 23, 34, 235), outline=(255, 255, 255, 40), width=1)
        img.paste(layer, (0, 0), layer)
        f_icon = font(int(16 * s))
        for i, ic in enumerate(icons):
            bb = f_icon.getbbox(ic)
            cx = chip_x + int(4 * s) + i * icon_w + (icon_w - (bb[2] - bb[0])) // 2 - bb[0]
            text(img, (cx, chip_y + int(5 * s)), ic, f_icon, TEXT_DIM)

    # Settings panel overlay (renders ABOVE the events area when shown)
    if show_settings:
        _draw_settings(img, x, y, w, h, s)


def _draw_event(img, x, y, w, t, impact, country, title, prev, fcst, scale=1.0, bright=True, very_faded=False):
    s = scale
    d = ImageDraw.Draw(img, "RGBA")
    # time column
    time_col = TEXT if bright else (TEXT_DIM if not very_faded else MUTED)
    text(img, (x, y), t, font(int(11 * s), "SemiBold"), time_col)
    # content row
    cx = x + int(40 * s)
    # dot
    dot_size = int(7 * s)
    dot_color = {"high": RED, "medium": ORANGE, "low": GREEN, "holiday": SLATE}.get(impact, DIMMER)
    d.ellipse([cx, y + int(4 * s), cx + dot_size, y + int(4 * s) + dot_size], fill=dot_color)
    # country
    text(img, (cx + int(12 * s), y + int(1 * s)), country, font(int(9 * s), "Bold"), MUTED)
    # title
    title_color = (232, 235, 240) if bright else (209, 212, 220)
    if very_faded: title_color = (179, 184, 194)
    # truncate title if too wide
    avail = w - int(72 * s)
    tf = font(int(11 * s), "Regular")
    title_disp = title
    while tf.getbbox(title_disp + "…")[2] > avail and len(title_disp) > 4:
        title_disp = title_disp[:-1]
    if title_disp != title:
        title_disp += "…"
    text(img, (cx + int(35 * s), y), title_disp, tf, title_color)
    # arrow at end of title row
    arrow_x = x + w - int(10 * s)
    text(img, (arrow_x, y), "↗", font(int(10 * s)), (95, 168, 224, 80))
    # values
    if prev or fcst:
        v = f"{prev}  →  {fcst}" if prev and fcst else (prev or f"→  {fcst}")
        text(img, (cx + int(13 * s), y + int(15 * s)), v, font(int(10 * s)), (138, 144, 160))


def _draw_settings(img, px, py, pw, ph, s):
    """Draw settings panel overlay inside the popup."""
    d = ImageDraw.Draw(img, "RGBA")
    pad = int(10 * s)
    # Fully opaque cover over the events area so the panel is unambiguous.
    panel_top = py + int(2 * s)
    panel_bot = py + int(220 * s)
    d.rectangle([px + 1, panel_top, px + pw - 1, panel_bot], fill=BG)

    cur_y = panel_top + int(18 * s)
    # Impact label
    text(img, (px + pad, cur_y), "IMPACT", font(int(9 * s), "Bold"), MUTED)
    cur_y += int(18 * s)
    # Pills
    px_ = px + pad
    pill_labels = [("high", RED, "High", True),
                   ("medium", ORANGE, "Medium", True),
                   ("low", GREEN, "Low", False),
                   ("holiday", SLATE, "Holiday", False)]
    for imp, col, lbl, active in pill_labels:
        f = font(int(10 * s), "Regular")
        bbox = f.getbbox(lbl)
        pill_w = int(20 * s) + bbox[2] - bbox[0]
        pill_h = int(20 * s)
        bg_alpha = 32 if active else 12
        rounded(d, [px_, cur_y, px_ + pill_w, cur_y + pill_h], int(11 * s), fill=(255, 255, 255, bg_alpha))
        # dot — dimmed (~35 % luminance) when the impact is filtered out
        dot_fill = col if active else tuple(int(c * 0.35) for c in col)
        dot_size = int(7 * s)
        dot_y = cur_y + (pill_h - dot_size) // 2
        d.ellipse([px_ + int(7 * s), dot_y, px_ + int(7 * s) + dot_size, dot_y + dot_size], fill=dot_fill)
        # label
        text(img, (px_ + int(18 * s), cur_y + int(3 * s)), lbl, f, WHITE if active else MUTED)
        px_ += pill_w + int(4 * s)

    cur_y += int(28 * s)
    # Text size label
    text(img, (px + pad, cur_y), "TEXT SIZE", font(int(9 * s), "Bold"), MUTED)
    cur_y += int(18 * s)
    # Segmented S/M/L
    seg_x = px + pad
    seg_w_each = int(32 * s)
    seg_h = int(22 * s)
    rounded(d, [seg_x, cur_y, seg_x + seg_w_each * 3 + int(4 * s), cur_y + seg_h], int(5 * s), fill=(255, 255, 255, 12))
    for i, lbl in enumerate(["S", "M", "L"]):
        active = lbl == "M"
        sx = seg_x + int(2 * s) + i * seg_w_each
        if active:
            rounded(d, [sx, cur_y + int(2 * s), sx + seg_w_each, cur_y + seg_h - int(2 * s)], int(3 * s), fill=(255, 255, 255, 30))
        bb = font(int(10 * s), "SemiBold").getbbox(lbl)
        tx = sx + (seg_w_each - (bb[2] - bb[0])) // 2
        text(img, (tx, cur_y + int(4 * s)), lbl, font(int(10 * s), "SemiBold"), WHITE if active else MUTED)

    cur_y += int(34 * s)
    # Opacity label + value
    text(img, (px + pad, cur_y), "OPACITY", font(int(9 * s), "Bold"), MUTED)
    text(img, (px + pw - pad - int(28 * s), cur_y), "80%", font(int(9 * s), "Bold"), TEXT_DIM)
    cur_y += int(20 * s)
    # Range slider
    slider_y = cur_y + int(6 * s)
    slider_x1 = px + pad
    slider_x2 = px + pw - pad
    rounded(d, [slider_x1, slider_y, slider_x2, slider_y + int(4 * s)], int(2 * s), fill=(255, 255, 255, 25))
    knob_x = slider_x1 + int((slider_x2 - slider_x1) * 0.66)
    d.ellipse([knob_x - int(6 * s), slider_y - int(4 * s), knob_x + int(6 * s), slider_y + int(8 * s)], fill=WHITE)


# ---- Small promo tile (440 x 280) ------------------------------------------

def make_small_promo():
    w, h = 440, 280
    img = Image.new("RGB", (w, h), BG)
    vgrad(img, (16, 19, 30), (28, 32, 48))
    d = ImageDraw.Draw(img, "RGBA")

    # Soft blue glow behind the icon
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([8, 60, 168, 220], fill=(41, 98, 255, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    img.paste(glow, (0, 0), glow)

    # Icon
    icon = Image.open(f"{ROOT}/icons/icon128.png").convert("RGBA")
    icon = icon.resize((96, 96), Image.LANCZOS)
    img.paste(icon, (38, h // 2 - 48), icon)

    # Title
    text(img, (158, 88), "NewsAnchor", font(40, "Bold"), WHITE)
    # Tagline
    text(img, (159, 138), "Forex Factory events,", font(15), MUTED)
    text(img, (159, 158), "anchored to your TradingView chart.", font(15), MUTED)

    # Small badge (accent)
    rounded(d, [158, 192, 270, 218], 13, fill=(41, 98, 255, 50), outline=(41, 98, 255, 180), width=1)
    text(img, (170, 197), "FREE · MV3", font(11, "SemiBold"), (155, 195, 255))

    img.save(f"{OUT}/promo-small-440x280.png", "PNG")
    print("✓ small promo")


# ---- Large promo / marquee (1400 x 560) ------------------------------------

def make_large_promo():
    w, h = 1400, 560
    img = Image.new("RGB", (w, h), BG)
    vgrad(img, (12, 15, 24), (28, 33, 50))
    d = ImageDraw.Draw(img, "RGBA")

    # Diagonal accent ray
    ray = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for i in range(140):
        a = int(28 * (1 - i / 140))
        ImageDraw.Draw(ray).line([(0, h - 200 + i), (w, h - 700 + i)], fill=(41, 98, 255, a), width=1)
    ray = ray.filter(ImageFilter.GaussianBlur(20))
    img.paste(ray, (0, 0), ray)

    # Left side: text block
    text(img, (88, 158), "NewsAnchor", font(96, "Bold"), WHITE)
    text(img, (92, 270), "Forex Factory events,", font(28), MUTED)
    text(img, (92, 308), "anchored to your TradingView chart.", font(28), MUTED)

    # Feature bullets
    feats = [
        "Auto-detects the symbol on screen",
        "Forex · indices · commodities · crypto · stocks",
        "Today highlighted · click-through to source",
    ]
    for i, fline in enumerate(feats):
        # blue dot
        d.ellipse([96, 380 + i * 36 + 6, 106, 380 + i * 36 + 16], fill=BLUE)
        text(img, (118, 380 + i * 36), fline, font(18), TEXT_DIM)

    # Right side: popup mockup at scale 1.4
    px, py = w - 480, 50
    draw_popup(img, px, py, scale=1.35, show_actions=False)

    # Bottom-right tag
    rounded(d, [w - 220, h - 70, w - 50, h - 40], 14, fill=(255, 255, 255, 14))
    text(img, (w - 207, h - 66), "FREE · OPEN-SOURCE", font(14, "SemiBold"), TEXT_DIM)

    img.save(f"{OUT}/promo-large-1400x560.png", "PNG")
    print("✓ large promo")


# ---- Screenshots (1280 x 800) ----------------------------------------------

def make_screenshot(name, scenario):
    w, h = 1280, 800
    img = Image.new("RGB", (w, h), BG)
    vgrad(img, (12, 15, 24), (22, 26, 38))
    d = ImageDraw.Draw(img, "RGBA")

    # Fake TradingView-like chrome
    # Top bar
    d.rectangle([0, 0, w, 44], fill=(15, 18, 28))
    d.rectangle([0, 44, w, 45], fill=(28, 32, 48))
    # Sidebar
    d.rectangle([0, 45, 56, h], fill=(15, 18, 28))
    d.rectangle([55, 45, 56, h], fill=(28, 32, 48))
    # Symbol pill (top-left)
    rounded(d, [78, 12, 220, 36], 5, fill=(28, 32, 48))
    text(img, (94, 16), scenario.get("symbol", "GBPAUD"), font(13, "SemiBold"), WHITE)
    text(img, (164, 18), "· 1h", font(11), MUTED)
    # Right-side bar
    d.rectangle([w - 56, 45, w, h], fill=(15, 18, 28))
    d.rectangle([w - 56, 45, w - 55, h], fill=(28, 32, 48))
    # Bottom bar
    d.rectangle([0, h - 30, w, h], fill=(15, 18, 28))
    d.rectangle([0, h - 31, w, h - 30], fill=(28, 32, 48))

    # Chart area
    chart_x, chart_y = 70, 60
    chart_w, chart_h = w - 70 - 70, h - 60 - 40
    draw_chart(img, chart_x, chart_y, chart_w, chart_h, seed=scenario.get("seed", 1))

    # Popup placement (top-right by default)
    popup_x = scenario.get("popup_x", w - 56 - 280 - 24)
    popup_y = scenario.get("popup_y", 70)
    scale = scenario.get("scale", 1.0)
    draw_popup(
        img, popup_x, popup_y, scale=scale,
        show_actions=scenario.get("show_actions", False),
        show_settings=scenario.get("show_settings", False),
        symbol_label=scenario.get("symbol", "GBPAUD"),
    )

    # Caption (small, top center)
    caption = scenario.get("caption")
    if caption:
        title_f = font(28, "Bold")
        bb = title_f.getbbox(caption)
        cx = (w - (bb[2] - bb[0])) // 2
        # Caption background
        rounded(d, [cx - 16, 50, cx + (bb[2] - bb[0]) + 16, 92], 8, fill=(19, 23, 34, 220), outline=(255, 255, 255, 18), width=1)
        text(img, (cx, 55), caption, title_f, WHITE)

    # Save as RGB (no alpha) — CWS requires it
    img.convert("RGB").save(f"{OUT}/{name}.png", "PNG")
    print(f"✓ {name}")


if __name__ == "__main__":
    make_small_promo()
    make_large_promo()
    make_screenshot("screenshot-1-hero-1280x800", {
        "symbol": "GBPAUD",
        "seed": 7,
        "caption": "Economic events, anchored to your chart",
    })
    make_screenshot("screenshot-2-settings-1280x800", {
        "symbol": "EURUSD",
        "seed": 11,
        "show_settings": True,
        "caption": "Built-in settings · impact · text size · opacity",
    })
    make_screenshot("screenshot-3-hover-1280x800", {
        "symbol": "XAUUSD",
        "seed": 4,
        "show_actions": True,
        "caption": "Hover the popup — actions appear, the rest stays clean",
    })
    print("done →", OUT)
