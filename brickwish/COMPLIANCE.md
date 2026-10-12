# BrickWish: Compliance Checklist (US)

A summary of official requirements with sources, as of 12 October 2026. **This is not legal advice.** Have a product-safety lab and an attorney confirm before launch.

Tags: **[OFF]** confirmed from official-source text (cpsc.gov, ecfr.gov, ftc.gov, federalregister.gov, lego.com) via search extracts · **[SEC]** law-firm or industry sources only · **[UNV]** not confirmed this session · **[ANALYSIS]** our reading, not a stated rule.

## Key facts

- **We are the certifier.** We assemble kits in the US from imported bricks + our manual + our box. That makes us the manufacturer/private labeler of the finished product, so **we** issue the Children's Product Certificate (CPC). We can't just pass along the factory's certificate. If we are the importer of record, the import duties are ours too. [OFF] [16 CFR 1110.7](https://www.ecfr.gov/current/title-16/chapter-II/subchapter-B/part-1110/section-1110.7)
- **Supplier test reports** can be reused for **component** tests (lead, heavy elements, phthalates) only if we use due care, the lab is CPSC-accepted, the report traces to the exact part and supplier, and the part is unchanged. **Small-parts and use-and-abuse tests must be run on the finished kit.** [OFF] [CPSC component testing](https://cpsc.gov/business--manufacturing/testing-certification/third-party-testing/component-part-testing)
- **ASTM F963-23** is the mandatory toy standard (16 CFR 1250, effective 20 April 2024). [OFF] [eCFR part 1250](https://www.ecfr.gov/current/title-16/chapter-II/subchapter-B/part-1250)
- **Certificate eFiling** has been mandatory for imports since **8 July 2026**. [OFF] [CPSC eFiling FAQ](https://www.cpsc.gov/FAQ/eFiling-Frequently-Asked-Questions-FAQ)
  - Open question: do loose bricks imported in bulk for US kitting need a CPC at entry, or a "disclaim" message? Ask the customs broker or CPSC. [UNV]

## The automatic dropship model: what changes

- **We're still the certifier.** The kit is our private-label product even though the vendor packs and ships it. The CPC comes from *our* lab testing of the palette (component testing by element and color, plus finished-kit tests by kit family). [ANALYSIS]
- **Every parcel is an import.** Ask a customs broker who the **importer of record** is when the vendor ships DDP. Whoever it is must eFile the certificate data at entry; we provide it. The US ended duty-free *de minimis* treatment for low-value parcels in 2025, so expect formal or informal entry on each parcel. [UNV, confirm with the broker]
- **Labels move to the vendor.** The warning, tracking and origin labels must be on the outside of every parcel. Our vendor order includes the exact text. Check the first samples.
- **The manual is a PDF.** The choking warning must also be on the package itself (and is on page 2 of the manual and on the website).
- **The wish now goes to our server before payment, to make the free preview.** We keep it safe by [ANALYSIS]:
  - the website and API strip contact details from the wish;
  - the API logs no IP addresses and sets no cookies;
  - a design is stored under a random code with no personal data, and unpaid designs are deleted after 30 days;
  - the parent gives notice and consent before anything personal (email, address, first name) is collected at payment.

  Confirm this design with a COPPA attorney or a Safe Harbor program before launch, along with the AI vendor's data terms (no training on, or reuse of, the text).

## Must do before the first sale

| # | Item | Why | Source |
|---|---|---|---|
| 1 | Treat **every** kit as a children's product, including 13+ | The site is kid-directed; CPSC looks at marketing, not just the age label | [UNV] [16 CFR 1200](https://www.ecfr.gov/current/title-16/chapter-II/subchapter-B/part-1200) |
| 2 | **Third-party testing at a CPSC-accepted lab:** lead ≤100 ppm in the material (≤90 ppm in paint/print); ASTM F963-23 (small objects, sharp points and edges, soluble heavy elements); 8 phthalates ≤0.1% each | Required for children's products. Specified ABS is exempt from phthalate testing (16 CFR 1308.2). A manual printed with CMYK inks on paper needs no lead test (16 CFR 1500.91) | [OFF] [CPSC phthalates](https://www.cpsc.gov/Business--Manufacturing/Business-Education/Business-Guidance/Phthalates) |
| 3 | **Issue the CPC.** Keep records for 5 years. Retest at least yearly and after any change of resin or supplier | Required | [OFF] [CPSC CPC](https://www.cpsc.gov/Business--Manufacturing/Testing-Certification/Childrens-Product-Certificate) |
| 3a | How to certify one-off kits: certify a fixed **"element library"** (the palette) plus a finished-kit test per kit family | Every kit is a different mix of the same certified parts | [ANALYSIS]. Confirm with the lab or the CPSC Small Business Ombudsman |
| 4 | **Choking-hazard warning on the box** of 4–6 kits: safety-alert triangle + "WARNING: CHOKING HAZARD—Small parts. Not for children under 3 yrs." (We put it on all kits voluntarily) | Required for ages 3–6 with small parts. Small parts are banned for under-3s, so never market to toddlers | [OFF] [16 CFR 1500.19](https://www.ecfr.gov/current/title-16/chapter-II/subchapter-C/part-1500/section-1500.19) |
| 5 | **The same warning on web pages** where a 4–6 kit can be bought | Required for ads with a direct way to buy. **The site prototype already shows it at checkout and on the grown-ups page.** | [OFF] [16 CFR 1500.20](https://www.ecfr.gov/current/title-16/chapter-II/subchapter-C/part-1500/section-1500.20) |
| 6 | **Tracking label** on the box and manual: BrickWish, city/state, production date, order number | Required; parts too small to mark are exempt "to the extent practicable" | [OFF] [CPSC tracking labels](https://www.cpsc.gov/FAQ/Tracking-Label) |
| 7 | **eFile certificates** for each import through the customs broker | Required since 8 July 2026 | [OFF] |
| 8 | **Country of origin:** "Bricks made in China" on the box. **No "Made in USA"** claim | Repacked imports must show their origin | [OFF] [19 CFR 134.26](https://www.ecfr.gov/current/title-19/chapter-I/part-134/subpart-C/section-134.26), [FTC Made in USA](https://www.ftc.gov/business-guidance/resources/complying-made-usa-standard) |
| 9 | **COPPA program:** privacy notice, direct notice to parents + verifiable parental consent, written data-retention policy (published), written security program, separate consent before sharing kids' data with third parties | Amended rule; full compliance required since **22 April 2026** | [OFF] [Federal Register 2025-05904](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule), [16 CFR 312](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312) |
| 10 | **Keep LEGO out of our branding:** brand, product names, domain, social handles, ads. No LEGO-style box, no minifigure look-alikes | LEGO Fair Play policy; the minifigure is a protected 3D mark in the EU (US registration reported); LEGO sues minifig cloners | [OFF] [LEGO Fair Play](https://www.lego.com/en-us/legal/notices-and-policies/fair-play); [SEC] for the cases |
| 11 | **No genuine LEGO elements in v1** | We would have to certify them ourselves, without LEGO's lab reports | [ANALYSIS] |
| 12 | **Licensed characters:** decline, or make a generic version | Copyright and trademark risk | [ANALYSIS] |
| 13 | **LLC + sales tax:** GA LLC about $100 + $50/yr, sales tax 4% + local. FL LLC $125 + $138.75/yr, sales tax 6% + county. Remote-seller threshold $100k (GA: or 200 sales). Toys are taxable | Required to operate | [UNV] sos.ga.gov, dor.georgia.gov, dos.fl.gov/sunbiz, floridarevenue.com |
| 14 | **Product liability insurance**, about $1M per occurrence | Standard for toy brands; required by Amazon above a sales threshold | [UNV] get quotes |

## Before scaling

- **Small-batch registration with CPSC.** It gives relief from some third-party tests if prior-year revenue is ≤ about $1.44M and ≤7,500 units per product. Both we and the factory must qualify. [OFF] [CPSC small batch](https://www.cpsc.gov/Business--Manufacturing/Small-Business-Resources/Small-Batch-Manufacturers-and-Third-Party-)
- **Sales-tax nexus** in other states as volume grows. Amazon and Etsy collect tax on their own sales. [UNV]
- **Amazon / Etsy:** CPC + test reports on request; choking warnings in listings. [UNV]
- **EU / UK / Canada (later):** EN 71-1/2/3, CE marking, an EU-based responsible person (GPSR); UKCA; Canada Toys Regulations with a bilingual small-parts warning. [UNV]
- **State kids' privacy laws:**
  - The California Age-Appropriate Design Code is partly enjoined and back in district court; it likely applies only above CCPA size thresholds. [SEC]
  - Florida §501.1735 covers social media and online games only, so **don't turn the site into a game.** [OFF]

## Nice to have

- Choking warning on **all** kits (siblings may be under 3). **(Already planned.)**
- Age grading using CPSC's [2020 Age Determination Guidelines](https://www.cpsc.gov/s3fs-public/2020%20Age%20Determination%20Guidelines.pdf).
- Join a [COPPA Safe Harbor program](https://www.ftc.gov/enforcement/coppa-safe-harbor-program).
- Use CPSC's Regulatory Robot and [Small Business Ombudsman](https://www.cpsc.gov/Business--Manufacturing/Small-Business-Resources).
- **AI honesty:** no federal rule requires labeling AI-assisted designs, but deceptive claims are illegal ("no AI exemption"). Don't say "hand-designed by master builders" if AI drafts the designs. [OFF] [FTC on AI](https://www.ftc.gov/industry/technology/artificial-intelligence)

## Safe wording

| Where | Use |
|---|---|
| Box (all kits) | ⚠ WARNING: CHOKING HAZARD—Small parts. Not for children under 3 yrs. |
| Box | Bricks compatible with LEGO® bricks. LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this product. |
| Box | Designed and packed in [City], [State], USA. Bricks made in China. |
| Box + manual | BrickWish · Order #[code] · Made [MM/YYYY] · [City, ST] |
| Website footer | LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this site. |
| Ads/SEO | Lead with "BrickWish Custom Brick Kits". "Compatible with LEGO® bricks" only in body copy, never in headlines, names or URLs |
| About us | Each design is drafted with help from AI tools and checked by our team. |
| **Never** | "LEGO kits", "LEGOs", "official", "genuine LEGO set", LEGO's red/yellow logo style, minifigure silhouettes, "Made in USA" |

## Website rules for COPPA (what the prototype already does)

| Rule | Status in `site/index.html` |
|---|---|
| The wish is sent for the free preview without anything personal | ✅ Only the scrubbed wish + options go to the API; no IP logging, no cookies; unpaid designs deleted after 30 days (`agents/worker.py`) |
| Hint not to type personal info; strip contact details automatically | ✅ "Just your idea. No names or addresses, please." and `scrub()` removes emails, phone numbers, links and street addresses |
| No accounts, chat, photo uploads or public gallery | ✅ None |
| No voice input (audio is personal information) | ✅ None. "Read it to me" only *speaks*; it never listens |
| No ad pixels, retargeting or behavioral ads | ✅ None |
| Parent gives notice and consent; the math gate alone is **not** consent | ✅ Math gate, then a consent checkbox + privacy note at checkout. The card payment serves as verifiable consent (check the current wording of 312.5(b)) |
| Only the builder's **first name** (optional) | ✅ Entered by the parent on the Stripe payment page (custom field, max 12 characters) |
| Published retention schedule | ✅ Checkout says "We delete the idea and first name 90 days after delivery." Still needed: a full privacy-notice page |
| AI vendor contract: no training or reuse of kids' text | ⏳ To do before connecting the Intake Agent |
| Self-host fonts (the prototype loads Google Fonts, which sends visitors' IP addresses to Google) | ⏳ To do in production |
