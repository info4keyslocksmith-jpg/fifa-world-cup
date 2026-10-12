"""Compiled model -> files the parts supplier needs to pick, pack and dropship the kit.

parts.csv          one row per part and color, per numbered bag (plus a spares bag)
bricklink.xml      BrickLink wanted-list format; most suppliers' upload tools accept it
vendor_order.json  everything for the order agent: bags, packing and label instructions, ship-to
"""

import csv
import io
import json
from collections import Counter
from xml.sax.saxutils import escape

from .palette import COLORS

PACKING = {
    "packaging": "BrickWish branded box or mailer; one sealed bag per bag number, with a sticker 'Bag N'.",
    "labels": [
        "WARNING: CHOKING HAZARD - Small parts. Not for children under 3 yrs. (with the safety-alert triangle)",
        "BrickWish, [City, State], USA · Order {code} · Made {month}",
        "Bricks made in China",
    ],
    "no_vendor_branding": True,
    "no_prices_in_parcel": True,
    "shipping": "DDP (duties and taxes paid). CPSC certificate eFiling done at entry by the carrier's broker.",
}


def bag_rows(model):
    per_bag = Counter((b.get("bag", 1), b["part"], b["name"], b["color"]) for b in model["bricks"])
    rows = [{"bag": bag, "part": part, "name": name, "color": color, "qty": qty}
            for (bag, part, name, color), qty in sorted(per_bag.items())]
    rows += [{"bag": "spares", "part": r["part"], "name": r["name"], "color": r["color"], "qty": r["spares"]}
             for r in model["bom"] if r["spares"]]
    for r in rows:
        _, bl_id, bl_name, _, _ = COLORS[r["color"]]
        r["bricklink_color_id"], r["bricklink_color"] = bl_id, bl_name
    return rows


def parts_csv(model):
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=["bag", "part", "name", "color", "bricklink_color_id", "bricklink_color", "qty"])
    w.writeheader()
    for r in bag_rows(model):
        w.writerow(r)
    return out.getvalue()


def bricklink_xml(model):
    totals = Counter()
    for r in bag_rows(model):
        totals[(r["part"], r["bricklink_color_id"])] += r["qty"]
    items = "".join(
        f"<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>{escape(part)}</ITEMID><COLOR>{color}</COLOR><MINQTY>{qty}</MINQTY></ITEM>"
        for (part, color), qty in sorted(totals.items()))
    return f"<INVENTORY>{items}</INVENTORY>\n"


def vendor_order(model, code, ship_to=None, month=""):
    rows = bag_rows(model)
    bags = {}
    for r in rows:
        bags.setdefault(str(r["bag"]), []).append({k: r[k] for k in ("part", "name", "bricklink_color_id", "bricklink_color", "qty")})
    packing = json.loads(json.dumps(PACKING).replace("{code}", code).replace("{month}", month or "MM/YYYY"))
    return {
        "order_code": code,
        "model": model["title"],
        "pieces": model["stats"]["pieces"],
        "pieces_with_spares": sum(r["qty"] for r in rows),
        "bags": bags,
        "packing": packing,
        "ship_to": ship_to or {"name": "", "address1": "", "address2": "", "city": "", "state": "", "zip": "", "country": "US"},
    }


def vendor_email(order):
    lines = [
        f"Subject: BrickWish order {order['order_code']} - {order['model']} ({order['pieces_with_spares']} pcs)",
        "",
        "Hello,",
        "",
        f"Please pick, pack and dropship BrickWish order {order['order_code']}.",
        f"- Parts: see the attached parts.csv (bag by bag) or bricklink.xml ({order['pieces_with_spares']} pieces including spares).",
        f"- Pack each bag number separately and label it 'Bag N'. Put the spares bag in last.",
        f"- Packaging: {order['packing']['packaging']}",
        "- Labels on the outside of the package:",
    ]
    lines += [f"    * {x}" for x in order["packing"]["labels"]]
    lines += [
        "- No vendor branding, invoices or prices inside the parcel.",
        f"- Shipping: {order['packing']['shipping']}",
        "",
        "Ship to:",
    ]
    st = order["ship_to"]
    lines += [f"    {st['name']}", f"    {st['address1']} {st['address2']}".rstrip(), f"    {st['city']}, {st['state']} {st['zip']}", f"    {st['country']}", ""]
    lines += ["Please reply with the tracking number and any part substitutions before shipping.", "", "Thank you,", "BrickWish Orders"]
    return "\n".join(lines)
