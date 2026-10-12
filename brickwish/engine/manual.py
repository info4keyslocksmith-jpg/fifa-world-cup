"""Compiled model -> building manual (HTML pages that browser.mjs prints to PDF and preview images).

Pages: cover, "before you build", steps (1, 2 or 4 per page by age), "you built it", parts list.
The first 5 pages, watermarked, are the free preview shown before the parent buys.
"""

import base64
import html
from collections import Counter
from pathlib import Path

from .palette import AGE_RULES, COLORS
from .render import H, View, part_svg, proj_bounds, rotated_180, scene_svg

ENGINE = Path(__file__).resolve().parent
FONT_FILES = {
    ("Baloo 2", 700): "node_modules/@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff2",
    ("Baloo 2", 800): "node_modules/@fontsource/baloo-2/files/baloo-2-latin-800-normal.woff2",
    ("Lexend", 400): "node_modules/@fontsource/lexend/files/lexend-latin-400-normal.woff2",
    ("Lexend", 600): "node_modules/@fontsource/lexend/files/lexend-latin-600-normal.woff2",
}

TEXT = {
    "en": {
        "built_by": "Built by", "pieces": "pieces", "steps": "steps", "ages": "Ages", "bags": "bags",
        "your_wish": "Your wish", "designed": "Designed by BrickWish just for you",
        "before": "Before you build",
        "tips": [
            "Build at a table, with a tray or a plate, so no piece rolls away.",
            "Open one bag at a time. The steps tell you when to open the next bag.",
            "Each step shows the new pieces in the blue box. In the picture, new pieces have a pink outline.",
            "Press every piece down until it clicks.",
            "Stuck? Ask a grown-up to help. Missing a piece? A grown-up can tell us and we'll send it free.",
        ],
        "how_to_read": "How to read a step", "new_pieces": "New pieces", "step": "Step",
        "open_bag": "Open bag", "kit": "In your kit",
        "warn_word": "WARNING:", "warn": "CHOKING HAZARD – Small parts. Not for children under 3 yrs.",
        "done": "You built it!", "front": "Front", "back": "Back",
        "share": "Ask a grown-up to send us a photo. We love seeing wishes come true.",
        "parts": "All your pieces", "spares": "Your kit also has a few spare small pieces, just in case.",
        "preview": "PREVIEW", "page": "Page", "order": "Order",
    },
    "es": {
        "built_by": "Construido por", "pieces": "piezas", "steps": "pasos", "ages": "Edades", "bags": "bolsas",
        "your_wish": "Tu deseo", "designed": "Diseñado por BrickWish solo para ti",
        "before": "Antes de construir",
        "tips": [
            "Construye en una mesa, con una bandeja o un plato, para que no se pierda ninguna pieza.",
            "Abre una bolsa a la vez. Los pasos te dicen cuándo abrir la siguiente.",
            "Cada paso muestra las piezas nuevas en el cuadro azul. En el dibujo, las piezas nuevas tienen un borde rosado.",
            "Presiona cada pieza hasta que haga clic.",
            "¿Te atoraste? Pide ayuda a un adulto. ¿Falta una pieza? Un adulto nos avisa y te la enviamos gratis.",
        ],
        "how_to_read": "Cómo leer un paso", "new_pieces": "Piezas nuevas", "step": "Paso",
        "open_bag": "Abre la bolsa", "kit": "En tu kit",
        "warn_word": "ADVERTENCIA:", "warn": "PELIGRO DE ASFIXIA – Piezas pequeñas. No apto para menores de 3 años.",
        "done": "¡Lo construiste!", "front": "Frente", "back": "Atrás",
        "share": "Pide a un adulto que nos envíe una foto. Nos encanta ver deseos cumplidos.",
        "parts": "Todas tus piezas", "spares": "Tu kit también trae algunas piezas pequeñas de repuesto, por si acaso.",
        "preview": "VISTA PREVIA", "page": "Página", "order": "Pedido",
    },
}

AGE_LABEL = {"4-6": "4–6", "7-9": "7–9", "10-12": "10–12", "13+": "13+"}

WARN_ICON = ('<svg viewBox="0 0 30 27" width="26" height="23" aria-hidden="true"><path d="M15 1.5 28.5 25.5H1.5Z" fill="none" '
             'stroke="#14203B" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 9.5v8" stroke="#14203B" stroke-width="3" '
             'stroke-linecap="round"/><circle cx="15" cy="21.3" r="1.8" fill="#14203B"/></svg>')
BAG_ICON = ('<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8Z" '
            'fill="#FFC629" stroke="#14203B" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" '
            'stroke="#14203B" stroke-width="1.6"/></svg>')


def _fonts_css():
    rules = []
    for (family, weight), rel in FONT_FILES.items():
        f = ENGINE / rel
        if f.exists():
            data = base64.b64encode(f.read_bytes()).decode()
            rules.append(f"@font-face{{font-family:'{family}';font-weight:{weight};font-style:normal;"
                         f"src:url(data:font/woff2;base64,{data}) format('woff2')}}")
    return "\n".join(rules)


CSS = """
@page { size: 8.5in 11in; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: #fff }
body { font-family: 'Lexend', 'Segoe UI', Arial, sans-serif; color: #14203B; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 8.5in; height: 11in; position: relative; overflow: hidden; break-after: page; background: #fff;
  padding: 0.45in 0.5in 0.65in; display: flex; flex-direction: column; gap: 14px }
.page:last-child { break-after: auto }
.foot { position: absolute; left: 0.5in; right: 0.5in; bottom: 0.28in; display: flex; justify-content: space-between;
  font-size: 10px; color: #4B5A7A; letter-spacing: .02em }
.brand { font: 800 18px/1 'Baloo 2', 'Arial Rounded MT Bold', sans-serif; display: flex; align-items: center; gap: 8px }
.brand i { width: 22px; height: 12px; background: #FFC629; border-radius: 2px; position: relative; display: inline-block;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,.18) }
.brand i::before { content: ""; position: absolute; top: -4px; left: 3px; width: 5px; height: 4px; background: #FFC629;
  border-radius: 1px 1px 0 0; box-shadow: 11px 0 0 #FFC629 }
h1, h2 { font-family: 'Baloo 2', 'Arial Rounded MT Bold', sans-serif; margin: 0; line-height: 1 }
/* cover */
.cover { background: #D9E9F7 radial-gradient(circle, #CFE1F3 0 6px, transparent 6.5px) 0 0 / 22px 22px }
.cover h1 { font-size: 58px; font-weight: 800; letter-spacing: -.01em; text-wrap: balance }
.cover .by { font-size: 22px; display: flex; gap: 10px; align-items: baseline }
.cover .by b { font: 800 30px/1 'Baloo 2', sans-serif; border-bottom: 3px solid #14203B; min-width: 3in; padding: 0 6px 2px }
.hero { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center }
.hero svg { width: 100%; height: 100% }
.chips { display: flex; gap: 10px; flex-wrap: wrap }
.chip { background: #fff; border: 2px solid #14203B; border-radius: 999px; padding: 6px 14px; font-weight: 600; font-size: 15px }
.wish { background: #fff; border-radius: 14px; padding: 12px 16px; font-size: 15px }
.wish span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #4B5A7A; margin-bottom: 2px }
/* before you build */
.tips { margin: 0; padding: 0; list-style: none; counter-reset: t; display: flex; flex-direction: column; gap: 12px; font-size: 17px; line-height: 1.4 }
.tips li { counter-increment: t; display: grid; grid-template-columns: 40px 1fr; gap: 12px; align-items: start }
.tips li::before { content: counter(t); width: 36px; height: 36px; border-radius: 50%; background: #14203B; color: #fff;
  display: grid; place-items: center; font: 800 18px/1 'Baloo 2', sans-serif }
.warn { display: flex; gap: 10px; align-items: center; border: 2px solid #14203B; border-radius: 10px; padding: 10px 12px; font-size: 14px }
.kitbox { display: flex; gap: 18px; flex-wrap: wrap; font-size: 16px }
.kitbox b { font: 800 34px/1 'Baloo 2', sans-serif; display: block }
.demo-step { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: start; background: #F5F9FE; border-radius: 14px; padding: 14px }
/* steps */
.steps { flex: 1; min-height: 0; display: grid; gap: 14px }
.steps.n1 { grid-template-rows: 1fr }
.steps.n2 { grid-template-rows: 1fr 1fr }
.steps.n4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr }
.step { min-height: 0; display: flex; flex-direction: column; gap: 8px; border-bottom: 2px dashed #C6D6EA; padding-bottom: 10px }
.step:last-child { border-bottom: 0 }
.step-head { display: flex; gap: 14px; align-items: flex-start }
.num { font: 800 56px/0.9 'Baloo 2', sans-serif; min-width: 1.2em; font-variant-numeric: tabular-nums }
.callout { background: #EAF3FC; border: 2px solid #9DBBDD; border-radius: 12px; padding: 8px 12px; display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end }
.callout .p { display: flex; flex-direction: column; align-items: center; gap: 2px; font: 800 15px/1 'Baloo 2', sans-serif }
.callout svg { height: 40px; width: auto }
.bag { display: inline-flex; gap: 6px; align-items: center; background: #FFC629; border: 2px solid #14203B; border-radius: 999px;
  padding: 4px 12px; font: 800 15px/1 'Baloo 2', sans-serif; margin-left: auto; white-space: nowrap }
.view { flex: 1; min-height: 0; display: flex; align-items: flex-start; justify-content: center; overflow: hidden }
.view svg { width: 100%; height: auto; display: block }
/* final + parts */
.final { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; min-height: 0 }
.final figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 0 }
.final svg { width: 100%; height: 100%; min-height: 0 }
.final figcaption { font: 800 18px 'Baloo 2', sans-serif }
.big-done { font-size: 64px; text-align: center }
.partsgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; align-content: start }
.pcell { border: 2px solid #E1EAF5; border-radius: 10px; padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; text-align: center }
.pcell svg { height: 44px; width: auto }
.pcell b { font: 800 18px/1 'Baloo 2', sans-serif }
/* preview watermark */
.preview .page::after { content: attr(data-wm); position: absolute; left: -10%; right: -10%; top: 42%; text-align: center;
  font: 800 120px/1 'Baloo 2', sans-serif; color: rgba(232, 23, 93, .13); transform: rotate(-32deg); pointer-events: none }
"""


def _esc(s):
    return html.escape(str(s))


def _callout(step_bricks, lang):
    counts = Counter((b["part"], b["color"], b["kind"], max(b["w"], b["d"]), min(b["w"], b["d"])) for b in step_bricks)
    cells = []
    for (part, color, kind, w, d), n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        icon = part_svg({"w": w, "d": d, "color": color, "kind": kind}, s=11)
        cells.append(f'<div class="p">{icon}<span>{n}x</span></div>')
    return f'<div class="callout" aria-label="{_esc(TEXT[lang]["new_pieces"])}">{"".join(cells)}</div>'


def build_pages(model, order_code="DEMO", builder=""):
    lang = model.get("lang", "en")
    t = TEXT[lang]
    rules = AGE_RULES[model["age"]]
    per_page = rules["steps_per_page"]
    bricks = model["bricks"]
    title = model["title_es"] if lang == "es" else model["title"]
    pages = []

    def foot():
        return f'<div class="foot"><span>BrickWish · {_esc(title)} · {t["order"]} {_esc(order_code)}</span><span>{t["page"]} {len(pages) + 1}</span></div>'

    # 1. cover
    st = model["stats"]
    cover_s = 12
    pages.append(
        f'<section class="page cover"><div class="brand"><i></i>BrickWish</div>'
        f'<h1>{_esc(title)}</h1>'
        f'<div class="by">{t["built_by"]} <b>{_esc(builder) if builder else "&nbsp;"}</b></div>'
        f'<div class="hero">{scene_svg(bricks, cover_s)}</div>'
        f'<div class="chips"><span class="chip">{st["pieces"]} {t["pieces"]}</span><span class="chip">{model["steps"]} {t["steps"]}</span>'
        f'<span class="chip">{t["ages"]} {AGE_LABEL[model["age"]]}</span><span class="chip">{model["bags"]} {t["bags"]}</span></div>'
        f'<div class="wish"><span>{t["your_wish"]}</span>“{_esc(model.get("wish") or title)}” · {t["designed"]}</div>'
        f'{foot()}</section>')

    # 2. before you build
    first = [b for b in bricks if b["step"] == 1]
    tips = "".join(f"<li>{_esc(x)}</li>" for x in t["tips"])
    pages.append(
        f'<section class="page"><h2 style="font-size:44px">{t["before"]}</h2><ol class="tips">{tips}</ol>'
        f'<h2 style="font-size:26px;margin-top:6px">{t["how_to_read"]}</h2>'
        f'<div class="demo-step"><span class="num">1</span><div style="display:flex;flex-direction:column;gap:8px">'
        f'{_callout(first, lang)}<span style="font-size:14px">{_esc(t["tips"][2])}</span></div></div>'
        f'<div class="kitbox"><div><b>{st["pieces"]}</b>{t["pieces"]}</div><div><b>{model["bags"]}</b>{t["bags"]}</div>'
        f'<div><b>{model["steps"]}</b>{t["steps"]}</div><div><b>{st["size_cm"][2]:.0f} cm</b>{"tall" if lang == "en" else "de alto"}</div></div>'
        f'<p class="warn">{WARN_ICON}<span><b>{t["warn_word"]}</b> {t["warn"]}</span></p>'
        f'{foot()}</section>')

    # 3. steps: constant scale, the camera follows the top of the build
    content_w = 7.5 * 96
    content_h = 11 * 96 - (0.45 + 0.65) * 96 - 14
    if per_page == 4:
        view_w, view_h = (content_w - 14) / 2, (content_h - 14) / 2 - 92
    else:
        view_w, view_h = content_w, (content_h - 14 * (per_page - 1)) / per_page - 92
    full = proj_bounds(bricks, 1)
    s = min(view_w / (full[2] - full[0] + 1.6), 40)
    x0, _, x1, _ = proj_bounds(bricks, s)
    pad = s * 0.8
    blocks = []
    prev_bag = 0
    for n in range(1, model["steps"] + 1):
        placed = [b for b in bricks if b["step"] <= n]
        new = [b for b in bricks if b["step"] == n]
        _, by0, _, by1 = proj_bounds(placed, s)
        top = by0 - pad
        height = min(by1 + pad, top + view_h) - top
        svg = scene_svg(placed, s, [b["id"] for b in new], box=(x0 - pad, top, x1 - x0 + 2 * pad, height))
        bag = new[0].get("bag", 1)
        bag_html = f'<span class="bag">{BAG_ICON}{t["open_bag"]} {bag}</span>' if bag != prev_bag else ""
        prev_bag = bag
        blocks.append(f'<div class="step"><div class="step-head"><span class="num">{n}</span>{_callout(new, lang)}{bag_html}</div>'
                      f'<div class="view">{svg}</div></div>')
    for i in range(0, len(blocks), per_page):
        chunk = blocks[i:i + per_page]
        pages.append(f'<section class="page"><div class="steps n{per_page}">{"".join(chunk)}</div>{foot()}</section>')

    # 4. you built it
    pages.append(
        f'<section class="page"><h2 class="big-done">{t["done"]}</h2>'
        f'<div class="final"><figure>{scene_svg(bricks, 10)}<figcaption>{t["front"]}</figcaption></figure>'
        f'<figure>{scene_svg(rotated_180(bricks), 10)}<figcaption>{t["back"]}</figcaption></figure></div>'
        f'<p style="text-align:center;font-size:16px;margin:0">{t["share"]}</p>{foot()}</section>')

    # 5. parts list
    rows = model["bom"]
    names = {k: (v[3] if lang == "en" else v[4]) for k, v in COLORS.items()}
    for i in range(0, len(rows), 24):
        cells = "".join(
            f'<div class="pcell">{part_svg(r, s=12)}<b>{r["qty"]}x</b><span>{_esc(r["name"])}</span><span>{_esc(names[r["color"]])} · {r["part"]}</span></div>'
            for r in rows[i:i + 24])
        pages.append(f'<section class="page"><h2 style="font-size:40px">{t["parts"]}</h2><div class="partsgrid">{cells}</div>'
                     f'<p style="margin:0;font-size:14px">{t["spares"]}</p>{foot()}</section>')
    return pages


def manual_html(model, order_code="DEMO", builder="", preview_pages=0):
    """Full manual, or (preview_pages=5) only the first pages with a PREVIEW watermark."""
    lang = model.get("lang", "en")
    pages = build_pages(model, order_code, builder)
    cls = ""
    if preview_pages:
        pages = [p.replace('<section class="page', f'<section data-wm="{TEXT[lang]["preview"]}" class="page', 1) for p in pages[:preview_pages]]
        cls = ' class="preview"'
    title = model["title_es"] if lang == "es" else model["title"]
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>{_esc(title)} · BrickWish</title>'
            f'<style>{_fonts_css()}{CSS}</style></head><body{cls}>{"".join(pages)}</body></html>')
