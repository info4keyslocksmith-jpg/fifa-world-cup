"""BrickWish unit economics per kit: automatic design + PDF manual + vendor dropship.

Every number below is an assumption. Replace them with real quotes (vendor per-piece price,
DDP shipping per parcel, Claude usage from the API dashboard) and re-run:
    python3 brickwish/tools/unit_economics.py
"""

TIERS = [
    # name, retail price (USD, US shipping included), pieces (midpoint), parcel shipping DDP at launch
    ("Mini", 39, 115, 8.00),
    ("Medium", 69, 275, 11.00),
    ("Big", 99, 525, 15.00),
    ("Mega", 179, 1000, 22.00),
]

SCENARIOS = {
    # Launch: Brickwith / Wobrick / Letbricks pick each parts list and dropship it in our branded bag.
    "Launch": dict(
        per_piece=0.045,       # bricks + per-order picking and bagging by the vendor
        packaging=1.50,        # branded mailer/bag + warning, tracking and origin labels
        ship_factor=1.00,      # DDP parcel China -> US door
        tariff=0.15,           # buffer on goods value for duties not included in the DDP quote
        design_ai=0.80,        # Claude design loop per wish (about 6 previews with images, effort high)
        conversion=0.25,       # share of designed wishes that get bought; unpaid designs still cost AI
        qa_minutes=5,          # a founder spot-checks the design and the vendor confirmation
        hourly=25,
    ),
    # Scale: negotiated per-piece price, consolidated shipping, tuned prompts, better conversion.
    "Scale": dict(
        per_piece=0.030,
        packaging=1.00,
        ship_factor=0.80,
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


def kit(price, pieces, ship, s):
    parts = pieces * s["per_piece"] * SPARES
    tariff = parts * s["tariff"]
    shipping = ship * s["ship_factor"]
    ai = s["design_ai"] / s["conversion"]          # AI cost per *sold* kit
    fees = price * CARD_FEE[0] + CARD_FEE[1]
    support = price * SUPPORT
    qa = s["qa_minutes"] / 60 * s["hourly"]
    total = parts + tariff + s["packaging"] + shipping + ai + fees + support + qa
    return dict(parts=parts, tariff=tariff, packaging=s["packaging"], shipping=shipping, ai=ai, fees=fees,
                support=support, qa=qa, total=total, profit=price - total)


def main():
    for name, s in SCENARIOS.items():
        print(f"\n### {name}\n")
        print("| Tier | Price | Parts | Duty buffer | Packaging | Shipping (DDP) | AI design | Card fees | Support | QA | Cost | Profit per kit |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for tier, price, pieces, ship in TIERS:
            k = kit(price, pieces, ship, s)
            print(f"| {tier} | ${price} | ${k['parts']:.2f} | ${k['tariff']:.2f} | ${k['packaging']:.2f} | ${k['shipping']:.2f} "
                  f"| ${k['ai']:.2f} | ${k['fees']:.2f} | ${k['support']:.2f} | ${k['qa']:.2f} | ${k['total']:.2f} "
                  f"| **${k['profit']:.2f} ({100 * k['profit'] / price:.0f}%)** |")


if __name__ == "__main__":
    main()
