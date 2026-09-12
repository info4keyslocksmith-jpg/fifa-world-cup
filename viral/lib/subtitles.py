#!/usr/bin/env python3
"""Karaoke captions as ASS.

The rules encoded here come from what actually reads on a phone:
  * 1-3 words on screen at a time, never a full sentence
  * one word highlighted in an accent colour as it is spoken
  * heavy black outline so it survives any background
  * a short scale-pop when a new card appears, so the frame keeps moving
  * everything inside the cross-platform safe zone

Timings are OUTPUT-timeline seconds. build.py remaps source time before calling in.
"""

import json
import re

SENTENCE_END = re.compile(r"[.!?]+[\"')\]]*$")
HARD_BREAK = re.compile(r"[,;:]+[\"')\]]*$")


def ass_color(hex_color, alpha="00"):
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha}{b}{g}{r}".upper() + "&"


def ass_time(t):
    t = max(t, 0.0)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def clean(word):
    return word.replace("{", "").replace("}", "").replace("\\", "").strip()


def split_phrases(words, max_gap):
    """Break the word stream where a viewer would naturally take a breath."""
    phrases, current = [], []
    for w in words:
        token = clean(w["w"])
        if not token:
            continue
        entry = {"w": token, "start": w["start"], "end": w["end"]}
        if current:
            gap = entry["start"] - current[-1]["end"]
            prev = current[-1]["w"]
            if gap > max_gap or SENTENCE_END.search(prev) or HARD_BREAK.search(prev):
                phrases.append(current)
                current = []
        current.append(entry)
    if current:
        phrases.append(current)
    return phrases


def pack_evenly(phrase, max_words, max_chars):
    """Split one phrase into near-equal cards.

    Packing greedily leaves orphans -- a four-word line under a three-word cap
    becomes 3 + 1, and that lone word flashes by too fast to read. Splitting
    evenly gives 2 + 2 instead.
    """
    n = len(phrase)
    k = max(1, -(-n // max_words))
    while k <= n:
        base, extra = divmod(n, k)
        sizes = [base + (1 if i < extra else 0) for i in range(k)]
        cards, i = [], 0
        for size in sizes:
            cards.append(phrase[i:i + size])
            i += size
        if all(len(" ".join(w["w"] for w in c)) <= max_chars for c in cards):
            return cards
        k += 1
    return [[w] for w in phrase]


def build_cards(words, cfg):
    """Group word timings into on-screen cards."""
    cards = []
    for phrase in split_phrases(words, cfg["max_gap_merge_seconds"]):
        cards.extend(pack_evenly(phrase, cfg["max_words_per_card"],
                                 cfg["max_chars_per_card"]))
    return cards


def card_windows(cards, cfg, hard_end):
    """Give each card a display window; close gaps so captions never flicker off.

    A card that would fall under the readable minimum borrows time from the pause
    that follows it, rather than flashing.
    """
    min_dur = cfg["min_card_seconds"]
    out = []
    for i, card in enumerate(cards):
        start = card[0]["start"]
        natural_end = card[-1]["end"]
        ceiling = cards[i + 1][0]["start"] if i + 1 < len(cards) else hard_end
        ceiling = min(ceiling, hard_end)

        end = max(natural_end, min(start + min_dur, ceiling))
        if ceiling > start:
            end = min(end, ceiling)   # never overlap the next card
        end = min(end, hard_end)
        if end > start:
            out.append({"words": card, "start": start, "end": end})
    return out


def render_card_text(card_words, active_index, cfg):
    fill = ass_color(cfg["fill"])
    active = ass_color(cfg["active_fill"])
    parts = []
    for j, w in enumerate(card_words):
        text = w["w"].upper() if cfg["uppercase"] else w["w"]
        if j == active_index:
            parts.append(f"{{\\c{active}}}{text}{{\\c{fill}}}")
        else:
            parts.append(text)
    return " ".join(parts)


def header(style):
    cap = style["caption"]
    ov = style["overlay"]
    canvas = style["canvas"]
    bold = -1 if cap["bold"] else 0
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {canvas['width']}
PlayResY: {canvas['height']}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{cap['font_name']},{cap['font_size']},{ass_color(cap['fill'])},{ass_color(cap['fill'])},{ass_color(cap['outline'])},{ass_color('#000000','80')},{bold},0,0,0,100,100,0,0,1,{cap['outline_width']},{cap['shadow_depth']},5,10,10,10,1
Style: Overlay,{cap['font_name']},{ov['font_size']},{ass_color(ov['fill'])},{ass_color(ov['fill'])},{ass_color(ov['outline'])},{ass_color('#000000','80')},{bold},0,0,0,100,100,0,0,1,{ov['outline_width']},{cap['shadow_depth']},5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def generate(words, style, hard_end, overlays=None):
    cap = style["caption"]
    canvas = style["canvas"]
    safe = style["safe_zone"]

    cx = canvas["width"] // 2
    cy = max(safe["top"], min(cap["baseline_y"], safe["bottom"]))

    cards = card_windows(build_cards(words, cap), cap, hard_end)
    lines = []

    pop = cap["pop_scale"]
    pop_ms = cap["pop_ms"]

    for card in cards:
        cw = card["words"]
        # One event per word so exactly one word is highlighted at a time.
        for i, w in enumerate(cw):
            start = card["start"] if i == 0 else w["start"]
            end = cw[i + 1]["start"] if i + 1 < len(cw) else card["end"]
            end = min(end, card["end"])
            if end <= start:
                continue
            anim = ""
            if i == 0:
                anim = (f"\\fscx{pop}\\fscy{pop}"
                        f"\\t(0,{pop_ms},\\fscx100\\fscy100)")
            text = render_card_text(cw, i, cap)
            lines.append(
                f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Cap,,0,0,0,,"
                f"{{\\an5\\pos({cx},{cy}){anim}}}{text}")

    for ov in (overlays or []):
        y = max(safe["top"], min(ov.get("y", style["overlay"]["top_y"]), safe["bottom"]))
        text = clean(ov["text"])
        if ov.get("uppercase", True):
            text = text.upper()
        text = text.replace("\n", "\\N")
        lines.append(
            f"Dialogue: 1,{ass_time(ov['start'])},{ass_time(ov['end'])},Overlay,,0,0,0,,"
            f"{{\\an5\\pos({cx},{y})\\fad(120,120)}}{text}")

    return header(style) + "\n".join(lines) + "\n", cards


def main():
    import argparse
    ap = argparse.ArgumentParser(description="words JSON -> ASS captions")
    ap.add_argument("words_json", help="analysis.json or a {'words':[...]} file")
    ap.add_argument("out_ass")
    ap.add_argument("--style", default="style/default.json")
    ap.add_argument("--end", type=float, default=None)
    args = ap.parse_args()

    data = json.load(open(args.words_json))
    words = data["words"] if isinstance(data, dict) else data
    style = json.load(open(args.style))
    end = args.end or (words[-1]["end"] + 1.0 if words else 1.0)

    ass, cards = generate(words, style, end)
    with open(args.out_ass, "w") as f:
        f.write(ass)
    print(f"{len(cards)} caption cards -> {args.out_ass}")


if __name__ == "__main__":
    main()
