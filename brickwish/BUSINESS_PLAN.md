# BrickWish: Business Plan

**You wish it, we design it, you build it.**
A child asks for anything (*"I want the Empire State Building"*). Our AI agents design a one-of-a-kind brick model in minutes. Before paying, the family watches a video of the model building itself and flips through the first 5 pages of the manual. After a grown-up pays, the full manual arrives as a PDF and our brick vendor ships the parts straight to the door. **Everything after the wish is automatic, 24/7.**

Version 2, 12 October 2026: the automatic, vendor-shipped model. Details:
- [AUTOMATION.md](AUTOMATION.md): how the 24/7 system works
- [VENDORS.md](VENDORS.md): who ships the parts
- [COMPLIANCE.md](COMPLIANCE.md): what the law requires
- [AI_PIPELINE.md](AI_PIPELINE.md): how the agents design

Working example: [examples/out/empire-state-building/](examples/out/empire-state-building/).

---

## 1. The opportunity

- **Building sets are the fastest-growing toy category.** US toys were $30.3B in 2025 (+6%); building sets grew +15% in the US and have grown six years in a row globally. *(Circana via the Toy Association, 2026.)*
- **Gifting drives the category.** About a third of toy revenue comes in Q4, and most of the rest is birthdays.
- **Nobody serves a kid's imagination.** Custom brick shops make photo replicas (pets, couples, houses) for adults, at $40–$500+, with 3–14 week waits and mostly no printed instructions. **No one turns a child's own idea into a kit under $100, and no one shows a preview before purchase.**
- **About 1 in 4 US children is Hispanic.** No competitor offers Spanish manuals; we do it automatically.

## 2. What the customer gets

| Before paying (free, in minutes) | After paying |
|---|---|
| A video of *their* model building itself, then spinning | The full step-by-step manual as a PDF, "Built by [name]" on the cover |
| The first 5 pages of the manual (cover, tips, first steps) | All the bricks in numbered bags + spares, shipped to the door |
| Piece count, steps and size | The video to keep and share |

| Size | Pieces | Building time | Best for ages | Price (US shipping incl.) |
|---|---|---|---|---|
| **Mini** | 80–150 | about 30 min | 4–6, 7–9 | **$39** |
| **Medium** | 200–350 | about 1 hour | 4–6, 7–9 | **$69** |
| **Big** | 400–650 | 2–3 hours | 7–9, 10–12, 13+ | **$99** |
| **Mega** | 800–1,200 | a weekend | 10–12, 13+ | **$179** |

Age changes the manual, not the price: 4–6 builders get 3 new pieces per step and one step per page; 13+ get 12 per step and four steps per page.

**Next products:**
- **Wish Certificate** gift card (the birthday kid designs it later). This is the holiday launch product (§7).
- **Printed manual** add-on (+$9).
- **Manual only** ($19 PDF for families who already have bricks; about 95% margin).
- **Party pack** (6–10 Minis of the same design).

## 3. How it works (all automatic)

1. **Wish:** the kid uses the phone-first site in English or Spanish. Contact details are stripped from the text, and nothing personal is collected from the child.
2. **Design Agent (Claude):** writes the model in the engine's shape language, compiles it, *looks at the renders*, fixes problems, and submits once the design is connected, inside the piece range and recognizable. Brands become generic versions with a note to the parent.
3. **Brick engine:** turns the design into real bricks, checks every connection, orders the steps by age, splits the parts into numbered bags, and draws the manual (PDF), the 5 preview pages and the 9:16 build video.
4. **Preview → payment:** a grown-up passes the gate, agrees to the privacy terms, and pays on Stripe (email, address and builder's name are collected there).
5. **Fulfillment:** the worker puts the builder's name on the cover, emails the vendor the parts list by bag with label and DDP instructions, and emails the parent a private link to the PDF.
6. **Vendor** picks, bags, labels and ships DDP to the customer in about 1–2 weeks.

People are needed only when an order lands in **needs_help** (the founders get an email), for vendor relationships, and for marketing.

## 4. Unit economics (automatic + dropship)

Model: [`tools/unit_economics.py`](tools/unit_economics.py). All inputs are assumptions until vendor quotes and real AI usage come in.

**Launch** (vendor packs each order; design AI cost spread over a 25% wish-to-purchase rate):

| Tier | Price | Parts | Shipping DDP | AI design per sale | All costs | **Profit per kit** |
|---|---:|---:|---:|---:|---:|---:|
| Mini | $39 | $5.43 | $8.00 | $3.20 | $23.63 | **$15.37 (39%)** |
| Medium | $69 | $12.99 | $11.00 | $3.20 | $37.10 | **$31.90 (46%)** |
| Big | $99 | $24.81 | $15.00 | $3.20 | $56.45 | **$42.55 (43%)** |
| Mega | $179 | $47.25 | $22.00 | $3.20 | $93.98 | **$85.02 (47%)** |

**Scale** (negotiated parts, consolidated shipping, tuned prompts, 35% conversion): **60–63% profit per kit.**

"All costs" also includes a duty buffer, packaging, card fees, a 3% support/replacement reserve and a few minutes of founder spot-checks.

**What this means:**
1. **Profitable from order #1.** There's no designer, printer or packer cost per order.
2. **The biggest costs are parts and international shipping,** so the two most important vendor quotes are **price per piece** and **DDP shipping per parcel**.
3. **Every free preview costs about $0.50–0.80 in AI usage.** The API caps designs per hour, and the conversion rate from preview to purchase is the KPI that matters most.

## 5. Legal and safety: launch blockers

Full checklist: [COMPLIANCE.md](COMPLIANCE.md).
- **Lab testing and the certificate:** test the brick palette at a CPSC-accepted lab (ASTM F963-23 + CPSIA) and issue the Children's Product Certificate **before the first kit ships**.
- **Imports:** sort out with a customs broker who is importer of record for vendor-shipped parcels and how the certificate is eFiled.
- **Labels on every parcel:** choking-hazard warning, tracking label, "Bricks made in China".
- **Choking warning on the website:** the site already shows it.
- **COPPA:**
  - Kids give no personal info.
  - Only the scrubbed wish goes to the AI.
  - A parent gives notice and consent before paying.
  - Data is deleted on a schedule.
  - The AI vendor contract must forbid training on kids' text.
- **LEGO® trademark:** never in our name, product names, ads or URLs. "Compatible with LEGO® bricks" may appear only in body text with the disclaimer.
- **Licensed characters:** generic versions (automatic). Landmarks are fine to build; don't use their trademarked names in ads.
- **AI honesty:** "Each design is created by our AI builders and checked automatically for buildability."

## 6. Brand

- **Name: BrickWish.** No toy business found using it; still needs a USPTO Class 28 search and filing. Avoid Imagibrick and Brixie (both taken).
- **Look:** chunky rounded type, a sky-blue baseplate background, bright brick colors, and pink outlines on new pieces in the manual.
- **Voice:** "tú" for kids, "usted" for parents in Spanish.

## 7. Go-to-market

The holidays are close. The automatic model helps: the preview is instant, but the bricks need 1–2 weeks, plus lab testing before the first kit ships.

| When | What |
|---|---|
| **Now to 22 Nov** | Connect the accounts (AUTOMATION.md §7), sign a vendor, test samples, lab testing, site live with **Wish Certificates** and free previews. |
| **27 Nov – 15 Dec** | Sell Wish Certificates **and** kits ordered by about 5 Dec (check the vendor's DDP times). Every customer sees a free preview first, which drives conversion. |
| **25 Dec – Feb** | Certificate redemption wave; the first few hundred orders. |
| **Spring 2027** | Birthday season, party packs, Spanish-language launch in Atlanta and Florida. |

**Your marketing distribution plan plugs in here.** The engine already produces the content: a 9:16 build video for every design, plus a "wish of the day" the agents design themselves (AUTOMATION.md §6).

## 8. Roadmap

| Week | Dates (2026) | Done when… |
|---|---|---|
| 1 | 12–18 Oct | Name search, LLC, domain. **Anthropic API key + first 20 real wishes through the Design Agent** (score them: would a kid recognize it?). Vendor outreach (VENDORS.md). |
| 2 | 19–25 Oct | Stripe Payment Links + webhook, email sending, server live with api.py + worker.py. Sample orders from 2 vendors with 2 engine-made parts lists. |
| 3 | 26 Oct–1 Nov | Engine upgrade 1: **plates and slopes** (more detail per piece). Privacy notice + terms. Lab quotes. |
| 4 | 2–8 Nov | Samples arrive: score clutch, colors, bags, labels, transit time. Pick the vendor. Palette to the lab. |
| 5 | 9–15 Nov | Wish Certificate checkout. Tracking-email agent. Self-hosted fonts. |
| 6 | 16–22 Nov | 10 friends-and-family orders end to end with real kids. Fix what they find. Launch. |

## 9. Startup budget (estimate)

| Item | Low | High |
|---|---:|---:|
| LLC, registered agent, licenses | $150 | $400 |
| Trademark search + USPTO filing | $350 | $1,500 |
| Vendor samples (2–3 vendors) | $150 | $400 |
| Lab testing (palette + finished-kit small parts) | $1,500 | $5,000 |
| Product liability insurance (year 1) | $500 | $3,000 |
| Server, domain, email, AI usage (first 3 months) | $150 | $600 |
| Launch marketing | $1,000 | $2,500 |
| **Total** | **≈ $3,800** | **≈ $13,400** |

That's lower than v1: no printer, no packaging run, no inventory.

## 10. KPIs

- **Preview → purchase rate** (the money KPI)
- AI cost per design
- % of designs that pass with no human (target 95%+)
- "Would your kid recognize it?" rating
- Days from payment to delivery
- Missing-piece rate (target under 2%)
- Reorders and referrals

## 11. Main risks

| Risk | Mitigation |
|---|---|
| Automatic designs aren't recognizable enough | Score the first 100 designs; add plates/slopes to the engine; keep a template library of proven shapes the agent can reuse; regenerate free on request |
| AI costs from previews nobody buys | Per-hour cap, effort tuning, prompt caching; conversion is the KPI |
| Vendor quality or speed | Samples from 2–3 vendors; spares in every kit; a second vendor ready |
| Shipping time (1–2 weeks from China) | Free instant preview + Wish Certificates; later, a US warehouse for the most-used parts |
| Tariffs and customs | DDP quotes; duty buffer in the model; broker sorts out importer of record and eFiling |
| COPPA / safety | Kid side collects nothing; consent at checkout; CPC before the first kit ships |
| Trademark complaints | Generic versions; never use brand or landmark names in ads |

## 12. Decisions needed from the founders

1. **Name:** BrickWish? (then the USPTO search)
2. **Prices:** $39 / $69 / $99 / $179?
3. **Vendor:** start with Wobrick or Letbricks (private-label dropship), with Brickwith as backup?
4. **Accounts:** who creates the Anthropic, Stripe and email accounts, and which state for the LLC (GA or FL)?
5. **Marketing:** share your distribution plan so we wire it into the agents.
