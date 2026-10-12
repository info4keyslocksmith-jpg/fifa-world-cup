# BrickWish

Personalized brick-building kits for kids. **You wish it, we design it, you build it.**
A kid asks for anything, at any of six levels (100 to 8,000 pieces). AI agents design a buildable model in minutes. The family watches **the video of their own model** building itself, then flips through the first 5 manual pages, for free. A grown-up buys, the full PDF manual arrives by email, and the vendor ships the bricks. Everything after the wish is automatic.

**The rule: every wish gets built.** See it in [examples/out/](examples/out/), each with `build.mp4`, `manual.pdf`, `preview-1..5.png`, `viewer.html` (3D) and the vendor files:

| Wish | Level | Pieces |
|---|---|---:|
| [Empire State Building](examples/out/empire-state-building/) | 1 Starter | 231 |
| [Puppy park in the BeltLine](examples/out/puppy-park-beltline/) | 3 Builder | 767 |
| [San Francisco bridge](examples/out/golden-gate-bridge/) | 4 Master | 1,359 |
| [Medellín mountain](examples/out/medellin-mountain/) | 6 Epic | 5,111 |

| Document | What's in it |
|---|---|
| [BUSINESS_PLAN.md](BUSINESS_PLAN.md) | The business: levels and prices, unit economics, go-to-market, roadmap, risks, decisions |
| [AUTOMATION.md](AUTOMATION.md) | The 24/7 system: flow, who does what, how to run it, Stripe setup, what you need to connect |
| [engine/DESIGN_GUIDE.md](engine/DESIGN_GUIDE.md) | The Design Agent's rules: every wish gets built, what each level includes, the shape language |
| [VENDORS.md](VENDORS.md) | Brick vendors for private-label dropship, plus packaging, 3PLs and the outreach email |
| [COMPLIANCE.md](COMPLIANCE.md) | US toy safety (CPSIA, ASTM F963-23, CPC, eFiling), COPPA, LEGO® trademark rules, safe wording |
| [AI_PIPELINE.md](AI_PIPELINE.md) | How the agents and the engine design, age rules, next upgrades, background research |

| Code | What it does |
|---|---|
| `site/index.html` | The kid-friendly mobile website (one file). Shows the 3D video of the kid's model, then the manual |
| `engine/engine.js` | The brick engine (no dependencies; runs in the browser and in Node): spec → bricks → connection check and repair → steps and bags → manual pages, vendor files |
| `engine/viewer.js` | The 3D build video (three.js) |
| `engine/cli.js` | Server side: `build` (manual PDF, preview pages, MP4 video, vendor files), `preview`, `manual`, `guide` |
| `agents/design_agent.py` | The Design Agent: Claude designs, compiles, looks at the renders, fixes, submits |
| `agents/api.py` | Web API for the site: wishes, preview status and files, Stripe webhook |
| `agents/worker.py` | Runs 24/7: design → preview → (paid) → vendor order + parent email; retention cleanup; daily report |
| `examples/` | Example design specs and their full output |
| `tools/unit_economics.py` | Cost and profit per kit by level; edit the assumptions and re-run |

## Quick start

```bash
cd brickwish
pip install -r requirements.txt
(cd engine && npm install)        # needs Node 18+, ffmpeg and Playwright's Chromium

# make a full kit from a design spec (no API key needed):
node engine/cli.js build examples/golden-gate-bridge.json out/ggb --builder Lucas

# try the website locally (serves the site, the engine and the examples):
python3 -m http.server 8080       # then open http://localhost:8080/site/

# run the business (needs ANTHROPIC_API_KEY and the settings in AUTOMATION.md):
python3 -m agents.api & python3 -m agents.worker
```

**Before launch:** connect the accounts listed in AUTOMATION.md §7, do the lab testing in COMPLIANCE.md, and self-host the website fonts.
