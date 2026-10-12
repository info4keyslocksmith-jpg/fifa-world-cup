# BrickWish

Personalized brick-building kits for kids: **you wish it, we design it, you build it.**

| File | What's in it |
|---|---|
| [BUSINESS_PLAN.md](BUSINESS_PLAN.md) | Opportunity, positioning, products and prices, unit economics, operations, go-to-market, 6-week roadmap, budget, risks, open decisions |
| [VENDORS.md](VENDORS.md) | Brick suppliers that pack one parts list per order or private label, packaging, printing, 3PLs, questions to ask, and outreach emails (EN/ES) |
| [AI_PIPELINE.md](AI_PIPELINE.md) | How AI agents + scripts + a designer turn a wish into a model, manual and parts list. Includes the Intake Agent prompt and JSON schema, and the age difficulty rules |
| [COMPLIANCE.md](COMPLIANCE.md) | US toy-safety (CPSIA, ASTM F963-23, CPC, eFiling), COPPA, LEGO® trademark rules, safe wording |
| [site/index.html](site/index.html) | The kid-friendly mobile website (single file, no build step, English/Spanish) |
| [tools/unit_economics.py](tools/unit_economics.py) | Cost and margin per kit. Edit the assumptions and run `python3 brickwish/tools/unit_economics.py` |

## The website

Open `site/index.html` in a browser, or deploy the `site/` folder to any static host (Netlify, Cloudflare Pages, GitHub Pages).

**The flow:** welcome → 1 What? → 2 Extras → 3 Colors → 4 Who's building (age) → 5 How big? → 6 Wish card → grown-up gate → checkout (parent) → wish code.

**Going live**, at the top of the `<script>`:

```js
const CONFIG = {
  demo: true,           // set to false
  orderEndpoint: "",    // your order inbox: receives the wish as JSON
  checkoutLinks: { mini: "", medium: "", big: "", mega: "" }, // Stripe Payment Links, one per size
};
```

Prices and piece ranges are in `TIERS`, the color palette is in `COLORS`, and all text in both languages is in `T`.

**Before launch:** self-host the two fonts (Baloo 2 and Lexend) instead of loading them from Google, and add a privacy-notice page. See COMPLIANCE.md.
