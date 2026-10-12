"""BrickWish unit economics per kit.

Every number below is an assumption. Replace them with real vendor quotes
(see VENDORS.md) and re-run:  python3 brickwish/tools/unit_economics.py
"""

TIERS = [
    # name, retail price (USD, US shipping included), pieces (midpoint of range), manual pages, US shipping cost
    ("Mini", 39, 115, 12, 6.00),
    ("Medium", 69, 275, 24, 8.00),
    ("Big", 99, 525, 40, 10.50),
    ("Mega", 179, 1000, 64, 14.00),
]

SCENARIOS = {
    # Launch: first ~100 orders. Supplier packs each parts list (Brickwith / Wobrick / Letbricks),
    # founders design every model, manuals printed on an office color laser.
    "Launch": dict(
        per_piece=0.060,  # bricks + supplier picking/bagging + freight + duty buffer
        box=3.50,  # mailer box + sticker + bags, small runs
        per_page=0.12,  # color laser, stapled or coil bound
        ship_factor=1.00,
        design_hours=[0.75, 1.5, 2.5, 4.0],  # template library still small
        pack_hours=0.33,
        hourly=25,
    ),
    # Scale: 1,000+ orders/month. Bulk palette bought direct from the factory, 30-50 template
    # families, AI pipeline drafting models and manuals, production printer, negotiated postage.
    "Scale": dict(
        per_piece=0.035,
        box=1.75,
        per_page=0.06,
        ship_factor=0.85,
        design_hours=[0.25, 0.5, 1.0, 1.75],
        pack_hours=0.20,
        hourly=22,
    ),
}

SPARES = 1.05  # 5% extra parts for spares and missing-piece replacements
CARD_FEE = (0.029, 0.30)  # typical card processing: 2.9% + 30 cents


def kit_costs(price, pieces, pages, shipping, s, design_h):
    parts = pieces * s["per_piece"] * SPARES
    manual = pages * s["per_page"]
    ship = shipping * s["ship_factor"]
    fees = price * CARD_FEE[0] + CARD_FEE[1]
    materials = parts + s["box"] + manual + ship + fees
    labor = (design_h + s["pack_hours"]) * s["hourly"]
    return parts, manual, ship, fees, materials, labor


def main():
    for name, s in SCENARIOS.items():
        print(f"\n### {name}\n")
        print("| Tier | Price | Parts | Box | Manual | Shipping | Card fees | Materials | Margin after materials | Labor | Profit per kit |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
        for (tier, price, pieces, pages, shipping), design_h in zip(TIERS, s["design_hours"]):
            parts, manual, ship, fees, materials, labor = kit_costs(price, pieces, pages, shipping, s, design_h)
            profit = price - materials - labor
            print(
                f"| {tier} | ${price} | ${parts:.2f} | ${s['box']:.2f} | ${manual:.2f} | ${ship:.2f} | ${fees:.2f} "
                f"| ${materials:.2f} | {100 * (price - materials) / price:.0f}% | ${labor:.2f} "
                f"| ${profit:.2f} ({100 * profit / price:.0f}%) |"
            )


if __name__ == "__main__":
    main()
