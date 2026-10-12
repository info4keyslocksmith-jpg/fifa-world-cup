"""BrickWish unit economics per kit, by level: automatic design + PDF manual + vendor dropship.

Every number below is an assumption. Replace them with real quotes (vendor price per piece,
DDP shipping per kg, Claude usage from the API dashboard) and re-run:
    python3 brickwish/tools/unit_economics.py
"""

LEVELS = [
    # level, name, retail price (USD, US shipping included), pieces (middle of the range),
    # AI factor (bigger models = longer specs and more preview rounds for the Design Agent)
    (1, "Starter", 39, 175, 1.0),
    (2, "Explorer", 79, 450, 1.0),
    (3, "Builder", 139, 950, 1.5),
    (4, "Master", 229, 1850, 2.0),
    (5, "Legend", 399, 3500, 3.0),
    (6, "Epic", 699, 6500, 4.0),
]
GRAMS_PER_PIECE = 1.2  # average plain brick weight, mixed sizes

SCENARIOS = {
    # Launch: Wobrick / Letbricks / Brickwith pick each parts list and dropship it in our branded bag.
    "Launch": dict(
        per_piece=0.045,       # bricks + per-order picking and bagging by the vendor
        packaging=1.50,        # branded mailer/box + warning, tracking and origin labels
        ship_base=6.0,         # DDP parcel China -> US door: base + per kg (air, consolidated)
        ship_per_kg=9.0,
        tariff=0.15,           # buffer on goods value for duties not included in the DDP quote
        design_ai=0.80,        # Claude design loop per Level 1 wish (times the level's AI factor)
        conversion=0.25,       # share of designed wishes that get bought; unpaid designs still cost AI
        qa_minutes=5,          # a founder spot-checks the design and the vendor confirmation
        hourly=25,
    ),
    # Scale: negotiated per-piece price, cheaper freight, tuned prompts, better conversion.
    "Scale": dict(
        per_piece=0.030,
        packaging=1.00,
        ship_base=5.0,
        ship_per_kg=7.0,
        tariff=0.15,
        design_ai=0.50,
        conversion=0.35,
        qa_minutes=0.5,
        hourly=22,
    ),
}

SPARES = 1.05             # 5% extra small parts in every kit
CARD_FEE = (0.029, 0.30)  # typical card processing
SUPPORT = 0.03            # reserve for missing-piece replacements and refunds, share of price


def kit(price, pieces, ai_factor, s):
    parts = pieces * s["per_piece"] * SPARES
    tariff = parts * s["tariff"]
    kg = pieces * GRAMS_PER_PIECE * SPARES / 1000 + 0.15
    shipping = s["ship_base"] + s["ship_per_kg"] * kg
    ai = s["design_ai"] * ai_factor / s["conversion"]   # AI cost per *sold* kit
    fees = price * CARD_FEE[0] + CARD_FEE[1]
    support = price * SUPPORT
    qa = s["qa_minutes"] / 60 * s["hourly"]
    total = parts + tariff + s["packaging"] + shipping + ai + fees + support + qa
    return dict(parts=parts, tariff=tariff, kg=kg, shipping=shipping, ai=ai, fees=fees, total=total, profit=price - total)


def main():
    for name, s in SCENARIOS.items():
        print(f"\n### {name}\n")
        print("| Level | Price | Pieces | Parts | Weight | Shipping (DDP) | AI design | Other* | Cost | Profit per kit |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for lv, lname, price, pieces, ai_factor in LEVELS:
            k = kit(price, pieces, ai_factor, s)
            other = k["total"] - k["parts"] - k["shipping"] - k["ai"]
            print(f"| {lv} {lname} | ${price} | {pieces:,} | ${k['parts']:.2f} | {k['kg']:.1f} kg | ${k['shipping']:.2f} | ${k['ai']:.2f} "
                  f"| ${other:.2f} | ${k['total']:.2f} | **${k['profit']:.2f} ({100 * k['profit'] / price:.0f}%)** |")
    print("\n*Other = duty buffer, packaging, card fees, support reserve and a few minutes of founder spot-checks.")


if __name__ == "__main__":
    main()
