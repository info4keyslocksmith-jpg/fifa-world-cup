# BrickWish: Business Plan

**You wish it, we design it, you build it.**
Personalized brick-building kits for kids. A child describes anything they imagine (*"a Dalmatian puppy with a red collar"*) and picks a size and an age range. We design a one-of-a-kind model, print a step-by-step manual made for that one model, and ship the bricks in a gift-ready BrickWish box.

Working draft, 12 October 2026. Research behind this plan: [VENDORS.md](VENDORS.md), [COMPLIANCE.md](COMPLIANCE.md), [AI_PIPELINE.md](AI_PIPELINE.md). Site prototype: [site/index.html](site/index.html).

---

## 1. The opportunity

- **Building sets are the fastest-growing toy category.** US toy sales were $30.3B in 2025 (+6%), and building sets grew +15%. Globally, building sets have grown six years in a row. LEGO's 2025 revenue grew 12% against a market that grew 7%. *(Circana via the Toy Association, 2026; LEGO annual results, March 2026.)*
- **Gifting drives the category.** About a third of toy revenue lands in Q4, and most other toy purchases are birthday gifts. A personalized gift commands a premium.
- **Nobody serves kids' imagination.** Custom brick businesses today make photo replicas (pets, couples, houses) for adult gift buyers, at $40–$500+ with 3–14 week waits and mostly digital or QR-code instructions. We found **no one turning a child's own idea into a printed-manual kit under $100.**
- **Bilingual families are underserved.** About 1 in 4 US children is Hispanic (2020 Census). No personalized-kit competitor we found offers Spanish manuals.

## 2. Positioning

| | Photo-replica shops (Build 'Em Pets, BrickPaws, Brick-You) | Generic brick sets | **BrickWish** |
|---|---|---|---|
| Starts from | A photo of something real | A catalog | **The child's imagination** |
| Who designs | Shop | Factory | **The child's idea + our designer** |
| Manual | Mostly digital/QR | Printed, generic | **Printed, made for this model, matched to the child's age** |
| Language | English | Multi | **English + Spanish** |
| Price | $40–$510 | $10–$200 | **$39–$179, US shipping included** |
| Wait | 3–14 weeks | Same day | **Sketch in 2 days, delivered in about 10 days (target)** |

**Brand promise for parents:** reliable for kids. That means a preview before we build, numbered bags, spare pieces, a free missing-piece guarantee, and fast shipping from the US. These directly answer the top complaints about custom and compatible kits (missing pieces, unsorted bags, no instructions, slow shipping, models that don't look like what was promised).

## 3. Product and pricing

| Size | Pieces | Building time | Best for ages | Price (US shipping incl.) |
|---|---|---|---|---|
| **Mini** | 80–150 | about 30 min | 4–6, 7–9 | **$39** |
| **Medium** | 200–350 | about 1 hour | 4–6, 7–9 | **$69** |
| **Big** | 400–650 | 2–3 hours | 7–9, 10–12, 13+ | **$99** |
| **Mega** | 800–1,200 | a weekend | 10–12, 13+ | **$179** |

Age changes the difficulty of the manual, not the price. Rules by age are in [AI_PIPELINE.md §5](AI_PIPELINE.md#5-difficulty-rules-by-age). For example, 4–6 builders get 1–3 new pieces per step and one step per page.

**Every box contains:** all bricks in numbered bags, a spare-parts bag, a printed manual with "Built by [first name]" on the cover, a digital copy of the manual, and the required safety and tracking labels.

**Add-ons and next products** (phase 2):
- **Wish Certificate** (gift card, $39–$179). The birthday kid designs their own build later. It solves "what do I order?" and the holiday shipping crunch. **This is the holiday 2026 launch product** (see §8).
- **Manual only** ($19). A PDF plus parts list for families who already have bricks. About 90% margin, and no inventory.
- **Rush design** (+$15), and **gift wrap and card** (+$6).
- **Party pack**: 6–10 Mini kits from the same wish, for birthday parties.

**Policies:** one free revision of the sketch. We decline licensed characters (Spider-Man, Bluey, Pikachu, etc.) and offer a generic version instead ("a superhero spider", "a blue puppy"). Nothing for ages under 3.

## 4. Unit economics

Model: [`tools/unit_economics.py`](tools/unit_economics.py). Every input is an assumption until vendor quotes come back. Re-run the script after updating it.

**Launch** (first ~100 orders: supplier packs each parts list, founders design everything, office printer):

| Tier | Price | Materials* | Margin after materials | Labor (design + pack at $25/h) | Profit per kit |
|---|---:|---:|---:|---:|---:|
| Mini | $39 | $19.62 | 50% | $27.00 | −$7.62 |
| Medium | $69 | $34.01 | 51% | $45.75 | −$10.76 |
| Big | $99 | $55.05 | 44% | $70.75 | −$26.80 |
| Mega | $179 | $93.67 | 48% | $108.25 | −$22.92 |

**Scale** (1,000+ orders/month: bulk palette, 30–50 template families, AI pipeline, production printer):

| Tier | Price | Materials* | Margin after materials | Labor | Profit per kit |
|---|---:|---:|---:|---:|---:|
| Mini | $39 | $13.23 | 66% | $9.90 | **$15.87 (41%)** |
| Medium | $69 | $22.40 | 68% | $15.40 | **$31.20 (45%)** |
| Big | $99 | $35.54 | 64% | $26.40 | **$37.06 (37%)** |
| Mega | $179 | $59.73 | 67% | $42.90 | **$76.37 (43%)** |

\* Materials = parts (+5% spares) + box + printed manual + US shipping + card fees.

**What this means:**
1. **Each kit covers its materials from day one (about 50% margin).** At launch, the founders' design hours are the investment.
2. **Design time is the whole game.** Launch assumes 45 min to 4 h of design per kit; scale assumes 15 min to 1¾ h. The levers are the **template library** (a Dalmatian is the dog template + white/black colors + a spots module) and the **AI pipeline** (AI_PIPELINE.md). Break-even for a Medium kit at launch is about **1.4 h** of total labor.
3. **Track design minutes per order from order #1.** It is the KPI that decides when to hire.
4. Prices are set just under gift thresholds ($39 < $40, $99 < $100) and well under photo-replica competitors ($40–$510).

## 5. Operations

### How an order flows

1. **Kid designs on the site** (phone-first, EN/ES). The idea stays on the device. A grown-up finishes checkout, which serves as the parental notice and consent step (COPPA, see COMPLIANCE.md).
2. **Intake Agent** (Claude) turns the wish into a structured design brief: template family, colors, piece budget and age rules. If something is unclear, it drafts questions for the parent.
3. **Designer** builds the model from a template in BrickLink Studio (free) with AI help, then emails a **preview render within 2 days**. The parent approves, with one free revision.
4. **QA + BOM**: scripts check the piece count, age rules and stock; the BOM Agent exports the parts list (BrickLink XML/CSV).
5. **Instructions**: steps are auto-ordered by age rules, then LPub3D (free, command line) makes the PDF. The designer flips through it to check.
6. **Parts**: the parts list is uploaded to the supplier, which picks it into sorted bags (launch), or we pick from our own US palette inventory (scale).
7. **Pack** in Atlanta: bags + printed manual + spares + labels into the branded box. **Ship** with USPS Ground Advantage via a discounted label tool.

### Fulfillment model: start with vendor-packed kits, move to US inventory

| | Launch (orders 1–300) | Scale (300+/month) |
|---|---|---|
| Parts | Supplier packs **one parts list per order** (Brickwith, Wobrick or Letbricks, no MOQ) | Bulk "BrickWish palette" (~120 elements × 12 colors) bought direct from Gobricks; picked in-house or by an Atlanta/Florida 3PL |
| Our box | We insert bags + manual into our box in Atlanta | Same, or 3PL kitting (FSI Atlanta, ShipMonk FL) |
| Speed | About 3–4 weeks (supplier lead time + shipping from China) | **7–10 days** door to door |
| Cash | No inventory | About $2–5k in stock |

Wobrick and Letbricks also offer **private-label dropship** (they pack in our branding and ship straight to the customer). We should test it on samples, but **we should not rely on it for customer orders**. We are the certifier of the finished kit (COMPLIANCE.md), and we lose quality control over each box.

### The design constraint that makes this work

Designers may only use parts from the **BrickWish palette**: the elements and colors our supplier stocks and our lab has tested. The 12 colors on the site are that palette. This keeps every model buildable, certifiable, and pickable from inventory.

### First template families (match the 12 picture buttons on the site)

Dog · Cat · Dinosaur (also Dragon with a wings module) · Horse (also Unicorn with a horn module) · Shark/Fish · Rocket · Car (also Race car) · Train · Castle · Robot · House. Each family gets four size variants (Mini to Mega), color slots, attach points for modules (crown, sunglasses, wings, flames, flowers, tiny friend: the "extras" on the site) and pre-sequenced steps for each age band.

## 6. Legal and safety: launch blockers

Full checklist with sources: [COMPLIANCE.md](COMPLIANCE.md). Must be done **before the first kit ships**:

1. **We are the certifier.** We assemble kits in the US, so we must issue a **Children's Product Certificate (CPC)**. It must be based on testing at a **CPSC-accepted lab** to **ASTM F963-23** and CPSIA (lead, phthalates). Supplier test reports can be reused for component tests only if the lab is CPSC-accepted and the report traces to the exact part. Small-parts tests must be done on the finished kit.
2. **eFiling of certificates** for imported bricks has been mandatory since **8 July 2026**. Ask a customs broker how to handle bulk loose parts.
3. **Choking-hazard warning** (safety-alert triangle + "WARNING: CHOKING HAZARD – Small parts. Not for children under 3 yrs.") goes on the box and on any web page where a 4–6 kit can be bought. The site already shows it at checkout and on the grown-ups page.
4. **Tracking label** on the box and manual (brand, city/state, production date, order number). Mark **"Bricks made in China"** on the box, and never claim "Made in USA".
5. **COPPA** (amended rule, fully in force since 22 April 2026). The site is designed so kids give us nothing: no accounts, no chat, no photos, no voice, no ad pixels. Contact details are stripped from the wish, and a parent gives notice and consent at checkout. Still needed: a privacy notice, a written data-retention policy (we delete the idea 90 days after delivery), a written security program, and a contract with the AI vendor that bars training on and reuse of kids' text.
6. **The LEGO trademark.** Never use it in our name, domain, product names, ads or headlines. "Compatible with LEGO® bricks" may appear only in body text, with the disclaimer. No minifigure look-alikes and no LEGO box look. Leave genuine LEGO elements out of v1, because we can't get LEGO's test reports.
7. **Business:** LLC (GA about $100 or FL $125), sales-tax registration, product liability insurance (about $1M per occurrence; get quotes), and a USPTO trademark search plus filing for "BrickWish" in Class 28.

Honesty line for marketing: *"Each design is drafted with help from AI tools and checked by our team."*

## 7. Brand

- **Name: BrickWish.** Web search found no toy or brick business using it (lowest risk of five names checked). A USPTO Class 28 search and an attorney clearance are still needed. **Avoid** Imagibrick (ImagiBRICKS™ exists) and Brixie (BRIXIES exists). Backup name: WishBricks.
- **Look:** chunky rounded type (Baloo 2), easy-reading body text (Lexend, designed for reading fluency), a sky-blue "baseplate" background with studs, and bright brick colors. We deliberately avoid LEGO's red/yellow logo treatment.
- **Voice:** short sentences for kids ("tú" in Spanish), calm and clear for parents ("usted").
- **Site features built for kids:** one question per screen, picture buttons for pre-readers, a "read it to me" button, a dice button for ideas, colors pre-picked from the wish (typing "dálmata" selects white + black), and a math-question gate before checkout.

## 8. Go-to-market

**Holiday 2026 is too close to ship custom kits safely, so we sell the wish instead.**

| When | What |
|---|---|
| **Now to 22 Nov** | Build (see §9). Put the site up with a waitlist and Wish Certificates. |
| **27 Nov (Black Friday) to 20 Dec** | Sell **Wish Certificates**: a printable card, plus a mailed card for an extra fee. The kid "makes the wish" on Christmas morning, and kits ship in January. Marketing: "The only gift they design themselves." |
| **26 Dec to Feb 2027** | Redemption wave = first 100–300 orders. Measure everything. |
| **Spring 2027** | Birthday season. Party packs, Etsy listing, Spanish-language community launch in Atlanta and Florida. |

**Channels, in order:**
1. **Short videos of real kids' wishes turning into builds** (Instagram/TikTok/YouTube Shorts), in English and Spanish. The wish → sketch → build arc makes a natural story format.
2. **Local launch:** Atlanta and Florida Hispanic communities, libraries, STEM clubs, and birthday-party venues.
3. **Parent micro-influencers:** send 20 free kits built from *their* kids' wishes.
4. **Grandparents** as gift buyers (Wish Certificates).
5. **Etsy and Amazon later.** Both require a CPC and test reports on request.

**Never:** targeted ads on kid-facing pages, collecting kids' data, or LEGO in ads or SEO headlines.

## 9. Roadmap: the next 6 weeks

| Week | Dates (2026) | Done when… |
|---|---|---|
| 1 | 12–18 Oct | Name confirmed after the USPTO search. LLC filed. Domain, email and Stripe set up. Outreach email sent to Wobrick, Letbricks, Brickwith and MyGobricks (template in VENDORS.md). Quotes requested from 2 CPSC-accepted labs. |
| 2 | 19–25 Oct | Studio + LPub3D installed. First 3 templates (dog, car, house) designed at Mini and Medium sizes. Sample orders placed with 2–3 suppliers, each with the same 2 test parts lists. |
| 3 | 26 Oct–1 Nov | Templates 4–8. Packaging designed (box, numbered bag stickers, warning and tracking label). Privacy notice + terms drafted. |
| 4 | 2–8 Nov | Samples arrive. Score them on clutch vs. LEGO®, color match, bag sorting, missing parts and lead time, then pick the supplier. Send the palette to the lab. |
| 5 | 9–15 Nov | Templates 9–12. Intake Agent live (it creates design briefs in the order inbox). Site: self-hosted fonts, Stripe Payment Links, Wish Certificate checkout, privacy page. |
| 6 | 16–22 Nov | 5 friends-and-family test orders end to end (wish → sketch → kit → build) with real kids, timed. Fix the manual layout for ages 4–6. Site live. |

## 10. Startup budget (estimate)

| Item | Low | High |
|---|---:|---:|
| LLC, registered agent, licenses | $150 | $400 |
| Trademark search + USPTO filing (Class 28) | $350 | $1,500 |
| Supplier samples (3 vendors × 2 kits) | $200 | $500 |
| Lab testing (palette + finished-kit small parts) | $1,500 | $5,000 |
| Product liability insurance (year 1) | $500 | $3,000 |
| Packaging first run (250 boxes, labels, bags) | $700 | $1,200 |
| Color laser printer, long-reach stapler, coil binder | $500 | $900 |
| Starter parts inventory (gap-filler palette) | $500 | $3,000 |
| Launch marketing (free kits, local events, video) | $1,000 | $2,500 |
| Website hosting, domain, AI usage | $50 | $300 |
| **Total** | **≈ $5,500** | **≈ $18,000** |

## 11. KPIs to track from order #1

Design minutes per tier (target: under the scale column in §4) · % of orders covered by a template · sketch approval on first try · days from order to delivered · missing-piece rate (target under 2%) · materials cost per kit vs. model · site conversion (start → paid) · reorders and referrals · reviews from parents and kids.

## 12. Main risks

| Risk | Mitigation |
|---|---|
| Design time blows up | Template library first, piece-budget limits, the AI pipeline, and the "new module" policy (each unusual order becomes a reusable module) |
| Clone-brick quality (loose clutch, color shifts) | Score samples from 3 suppliers before choosing; restrict designs to tested palette; spare parts in every box |
| Licensed-character requests | Policy: generic version or decline. The Intake Agent flags these automatically. |
| COPPA or safety misstep | Kid side collects nothing; parental consent at checkout; CPC before first shipment; COPPA Safe Harbor membership later |
| Tariff changes on China-made toys | Ask for DDP (duties-paid) quotes; keep a duty buffer in the parts cost; consider a second-country supplier at scale |
| Holiday crunch | Sell Wish Certificates instead of promising holiday delivery in year 1 |
| A competitor copies the idea | Speed, the bilingual brand, kids' stories as content, and the template library as an asset |

## 13. Decisions needed from the founders

1. **Name:** go with BrickWish, pending the USPTO search?
2. **Home state:** form the LLC in Georgia or Florida (where you'll pack and ship from)?
3. **Prices:** approve $39 / $69 / $99 / $179?
4. **Launch product:** start with Wish Certificates for the holidays and first kits in January (recommended), or rush kits for December?
5. **Who designs:** do the founders learn BrickLink Studio, or do we hire a freelance MOC designer to build the first 12 templates (Fiverr MOC designers start around $35 per model + $100 for commercial use)?
