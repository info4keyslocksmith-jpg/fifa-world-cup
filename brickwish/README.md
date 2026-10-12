# BrickWish

Personalized brick-building kits for kids. **You wish it, we design it, you build it.**
A kid asks for anything. AI agents design a buildable model in minutes. The family watches the build video and the first 5 manual pages for free. A grown-up buys, the full PDF manual arrives by email, and the vendor ships the bricks. Everything after the wish is automatic.

**See it:** [examples/out/empire-state-building/](examples/out/empire-state-building/), the complete output for "I want the Empire State Building":
- `manual.pdf` (37 pages)
- `build.mp4`
- `preview-1..5.png`
- `parts.csv`, `bricklink.xml`, `vendor_order.json`, `vendor_email.txt`

| Document | What's in it |
|---|---|
| [BUSINESS_PLAN.md](BUSINESS_PLAN.md) | The business: product, prices, unit economics, go-to-market, roadmap, risks, decisions |
| [AUTOMATION.md](AUTOMATION.md) | The 24/7 system: flow, who does what, how to run it, Stripe setup, what you need to connect |
| [VENDORS.md](VENDORS.md) | Brick vendors for private-label dropship, plus packaging, 3PLs and outreach emails (EN/ES) |
| [COMPLIANCE.md](COMPLIANCE.md) | US toy safety (CPSIA, ASTM F963-23, CPC, eFiling), COPPA, LEGO® trademark rules, safe wording |
| [AI_PIPELINE.md](AI_PIPELINE.md) | Design research, agent roles, age difficulty rules |

| Code | What it does |
|---|---|
| `site/index.html` | The kid-friendly mobile website (single file, EN/ES). `CONFIG.apiBase` empty = demo with the example design |
| `engine/` | Design spec → bricks → connection check → steps and bags → manual PDF, preview pages, build video, vendor files |
| `agents/design_agent.py` | The Design Agent: Claude designs, compiles, looks at the renders, fixes, submits |
| `agents/api.py` | Web API for the site: wishes, preview status and files, Stripe webhook |
| `agents/worker.py` | Runs 24/7: design → preview → (paid) → vendor order + parent email; retention cleanup; daily report |
| `examples/` | Example design specs and their full output |
| `tools/unit_economics.py` | Cost and profit per kit; edit the assumptions and re-run |

## Quick start

```bash
cd brickwish
pip install -r requirements.txt
(cd engine && npm install)        # needs Node 18+, ffmpeg and Playwright's Chromium

# make a full kit from a design spec (no API key needed):
python3 -m engine.pipeline examples/empire-state-building.json --out out/esb --builder Mateo

# run the business (needs ANTHROPIC_API_KEY and the settings in AUTOMATION.md):
python3 -m agents.api & python3 -m agents.worker
```

**Before launch:** connect the accounts listed in AUTOMATION.md §7, do the lab testing in COMPLIANCE.md, and self-host the website fonts.
