# BrickWish: Vendors

Research as of 12 October 2026, from search extracts of each vendor's own pages; the research agents could not open pages directly. Items marked **(unverified)** came from third-party sources only. **Confirm every price, MOQ and lead time with the vendor before deciding.**

## 0. What we need from a vendor (automatic dropship model)

Our worker emails the vendor one order at a time: `parts.csv` (parts by numbered bag) and `bricklink.xml`, plus the customer's address and label text. A kit is 100–8,000 pieces (levels 1–6) from a palette of 11 brick sizes, round bricks and cones in 15 colors. The vendor must:

1. **Pick one parts list per order** and pack **one sealed bag per bag number** ("Bag 1", "Bag 2"…), plus a spares bag.
2. Ship in **our branded mailer or bag**, with **no vendor branding, invoice or prices** inside.
3. Put three labels on the outside, using text we provide:
   - the choking-hazard warning (with the triangle symbol);
   - the tracking label (BrickWish, city/state, order number, month);
   - "Bricks made in China".
4. Ship **DDP** (duties paid) to US addresses, with the CPSC certificate **eFiled** at entry (we supply the certificate data).
5. Reply with the **tracking number within 48 hours**, and report any substitutions *before* shipping.
6. Ideally, accept orders by API or a shared upload portal later, so the worker can submit without email.

**Who fits:** Wobrick and Letbricks both advertise private-label packing and dropship to end customers. Brickwith (formerly Webrick) packs parts lists per copy with no minimum, but in Brickwith-branded bags under 100 copies, so ask about neutral bags.

## Shortlist: contact these first

| Role | First choice | Backup | Why |
|---|---|---|---|
| **Private-label pick, pack + dropship (our main vendor)** | **Wobrick** | **Letbricks** | Both state private label, color boxes/labels, and dropship to our customers; no or low MOQ |
| **Backup: one parts list per order** | **Brickwith** (formerly Webrick) | — | No MOQ. Accepts BrickLink Studio, BrickLink, Rebrickable and xlsx parts lists. Sorted inner bags (Brickwith-branded under 100 copies) |
| **Gap-filler loose parts** | **MyGobricks** | JoyGobricks | Sells Gobricks parts by part number and color; free shipping over $69 |
| **Bulk palette / OEM at scale** | **Gobricks** (Shantou factory) | Shantou Wange | The factory itself: 2,000+ molds, 50+ colors, OEM/private label from about 500 units |
| **Mailer boxes** | **Packlane** | Arka, Packola | MOQ 1 (corrugated); about $3.40/box at 250 |
| **Labels, stickers** | **Sticker Mule** | — | Stickers from 10; roll labels 50 for $57 |
| **Parts bags** | **Uline** | — | 2"×3" reclosable bags, about $15 per 1,000 |
| **Manual printing** | **In-house** color laser | Lulu (print API), Mixam | Cheapest and same-day for the first 100 orders |
| **Kitting / 3PL (later)** | **FSI** (Atlanta) | ShipMonk (Fort Lauderdale), All Points (Atlanta) | Kitting services in GA/FL |

**Sample plan:** send the **same two engine-made orders** (e.g. the Level 1 Empire State Building and the Level 3 Puppy Park from `examples/out/`) to Wobrick, Letbricks and Brickwith, shipped to Atlanta exactly as a customer would receive them. Score them on: clutch vs. LEGO® bricks, color match, bag sorting, missing parts, packaging, days to Atlanta, and total landed cost.

## 1. Compatible-brick part suppliers (per part / per parts list)

| Vendor | Country | What they offer | Small orders? | Private label / branded packing | MOQ / price / lead time | URL |
|---|---|---|---|---|---|---|
| **Brickwith** (formerly Webrick; reportedly owned by Gobricks since 2025 (unverified)) | China | Gobricks parts by part and color. Parts-list upload (Studio, LDD, BrickLink, Rebrickable, xlsx). "Custom Kits": one parts list packed per copy | Yes, no MOQ | Under 100 copies: sorted inner bags in a Brickwith-branded bag. 100+: machine-sealed bags. Custom box on request | 12 business days for 1–99 copies, 22 for 100+; about 7 days shipping. Trustpilot 2.8/5 from 26 reviews (unverified) | brickwith.com/en/solutions/custom-kits |
| **Wobrick** | China (unverified) | Gobricks parts, bulk upload, custom manuals, color boxes, polybags, labels | Email a parts list to get a quote | **Yes**: private label + worldwide dropship | "No MOQ for most projects" (an older page says 10 sets). 5–7 working days processing. Duties not included | wobrick.com/moc-customization |
| **Letbricks** | China | Custom parts lists (xls/csv by email), MOC kits, OEM | No MOQ for standard customization; wholesale 10/SKU | **Yes**: co-branded packaging, manuals with our logo, dropship | 2–4 weeks for customization, 15–30 business days bulk. service@letbricks.com | letbricks.com/distribution-and-wholesale |
| **MyGobricks** | Overseas | Authorized Gobricks distributor; bulk order tool | Yes | No | e.g. 1L bar $0.03, wedge 4×2 $0.10. Free shipping over $69. 10–18 business days | mygobricks.com |
| **Gobricks** (factory) | China | 2,000+ molds, 50+ colors, own factory, upload tool | Yes (via site) | OEM via its Alibaba store | — | gobricks.net |
| JoyGobricks | Unverified | Gobricks parts by part number; quotes on parts lists | Yes | No | e.g. Technic link 1×9 $0.11–0.15 | joygobricks.com |
| BuildMOC | China | Mostly MOC sets, some single parts | Yes | Reseller program (details not found) | — | buildmoc.com |

Useful: the open-source **GoBricksPart-API** maps LEGO part numbers to Gobricks (GDS) numbers: github.com/mnemocron/GoBricksPart-API

## 2. Genuine LEGO® elements (not for v1)

| Source | Notes |
|---|---|
| **BrickLink** (owned by LEGO) | New and used parts; wanted-list XML upload. Each store sets its own minimums and shipping. Median about $0.04–0.05 for common small parts |
| **Brick Owl** | Wishlist buying across up to 5 stores; no buyer fees |
| **LEGO Pick a Brick** | **Terms say personal use only, not resale.** US/Canada Standard elements reportedly paused 2 Nov 2026 to Q1 2027 (unverified) |

**Why not v1:** we would have to certify LEGO elements as components ourselves (no access to LEGO's test reports), per-part cost is 2–3× higher, and a mix of genuine and compatible parts complicates the "compatible with" wording. We could revisit for a premium tier.

## 3. OEM / private-label factories (scale, 500+ units)

| Vendor | Country | MOQ / price | Test reports | URL |
|---|---|---|---|---|
| **Shantou Gobricks Cultural Technology** | China | Custom work MOC 500; custom logo/packaging 1,000–10,000. Samples $5/unit (refundable), 7–10 days | Not found; ask | gobricks.en.alibaba.com |
| **Shantou Wange** | China | OEM/ODM; MOQ not published | Claims ASTM F963, CPSIA, Prop 65, EN71 (ask for report numbers) | made-in-china.com/showroom/wangeblocks |
| Guangdong Yuetian Technology | China | MOQ 300 sets at $8–10 (unverified) | — | alibaba.com |
| CorporateMocs | China | From 200 sets | EN71 on request (unverified) | corporatemocs.com |
| BuildaMOC | EU/US | Genuine LEGO; minimum project $3,500 | — | buildamoc.com/pages/for-business |
| Business Bricks / Playwell | US-facing | MOQ 250 | — | businessbricks.com, playwell-bricks.com |

## 4. Packaging

| Vendor | What | MOQ / price | URL |
|---|---|---|---|
| **Packlane** | Custom mailers and cartons | MOQ 1 corrugated, 25 paperboard; about $3.40/mailer at 250; cardstock box $1.90 | packlane.com |
| **Arka** | Custom boxes and mailers | From 10 units, from about $0.99/unit; 7–10 business days | arka.com |
| **Packola** | Mailers, tuck-front boxes | No minimum; single samples | packola.com |
| PakFactory | Folding cartons, rigid boxes | About 500 for folding cartons | pakfactory.com |
| EcoEnclose | Recycled boxes and mailers | 100 branded boxes; 500 custom poly mailers | ecoenclose.com |
| **Sticker Mule** | Stickers, labels, poly mailers | Stickers from 10; roll labels 50 for $57 | stickermule.com |
| **Uline** | Reclosable bags | 2"×3" 2-mil $15/1,000; 4-mil $27/1,000 | uline.com |

## 5. Instruction manuals

| Option | Notes | Price |
|---|---|---|
| **In-house** color laser + long-reach stapler (+ coil binder for levels 4–6) | Same-day, one-off printing. Best for the first 100+ orders | About $0.06–0.12/page |
| **Lulu** (print-on-demand + Print API) | Saddle stitch 4–48 pages; single personalized copies through the API | From about $4.30/booklet |
| **Mixam** | Saddle stitch under 48 pages; instant quotes | Quote tool |

Manuals for levels 3–6 run past 48 pages (100+ for 5,000-piece kits), so use coil binding or split them into numbered books (Book 1, Book 2), the way big retail sets do.

## 6. 3PL / kitting (Georgia and Florida, for later)

| Vendor | Location | Notes |
|---|---|---|
| **FSI** | Atlanta | Kitting and assembly; 850k sq ft (fsi3pl.com) |
| All Points | Atlanta | Kitting; Shopify/Amazon integrations (allpointsatl.com) |
| Porter Logistics | Atlanta | DTC fulfillment, value-added services |
| Buske Logistics | Cartersville GA, Orlando/Tampa FL | Kitting for subscription companies; skews large |
| **ShipMonk** | Fort Lauderdale FL | Kitting in batches of 50+ orders |
| Red Stag | Near Atlanta | Kitting add-on; heavy-goods focus |

A one-off kit has 40–150 different part/color lots. Having a 3PL pick loose parts would cost too much in per-pick fees. Use a 3PL only to combine **supplier-packed parts bags + manual + box**.

## Questions to ask every supplier

1. Will you pack **one unique parts list per order**? Which file formats do you accept? How do you handle missing or out-of-stock parts? What is the lead time?
2. Can you pack in **neutral or BrickWish-branded bags**, insert our manual, use our box, and ship with **no third-party branding or prices** in the parcel?
3. What are the MOQ and per-piece price tiers? Can you send your **stock color list** and part catalog?
4. Do you have current **ASTM F963-23, CPSIA (lead, phthalates) and EN71 test reports from a CPSC-accepted lab**? Please send the lab name, report numbers and dates, and confirm they cover these materials and colors.
5. What are the sample cost and timing?
6. Which carrier and transit time to Georgia/Florida? Is the price **DDP (duties paid)** or DAP?
7. What clutch tolerance and color consistency do you guarantee? What is your defect and replacement policy?
8. Do you claim any rights to our designs, manuals or packaging?

## Outreach email (ready to send)

> **Subject:** Private-label kitting inquiry: custom brick kits (US startup)
>
> Hello [Name],
>
> We are BrickWish, a US startup (Georgia/Florida) selling personalized building-brick kits for kids under our own brand. Each order is a unique custom model of 100 to 8,000 pieces (six size levels). Our system sends one order at a time by email: a parts list split into numbered bags (CSV and BrickLink XML), the customer's US address, and the text for three package labels. The instruction manual is digital, so there is nothing to print.
>
> Could you tell us whether you can:
> 1. Pick **one parts list per order** and pack **one sealed bag per bag number** (Bag 1, Bag 2, … plus a spares bag);
> 2. Ship in our branded mailer or bag with our three labels (safety warning, tracking label, country of origin), with no third-party branding, invoices or prices in the parcel;
> 3. Ship **DDP** to US customers, with CPSC certificate eFiling at US entry, and reply with a tracking number within 48 hours;
> 4. Later, receive orders through an API or upload portal instead of email.
>
> Please share your MOQs and per-piece price tiers, lead times, US shipping options (DDP or DAP) and transit times, your color and part catalog, your current ASTM F963-23 / CPSIA / EN71 test reports (lab name, report number, date), and sample costs. We would like to order samples of 2 test parts lists (about 230 and 770 pieces). Our largest kits are 5,000+ pieces (4–8 kg), so please also quote sea or consolidated freight for heavy parcels.
>
> We expect about 100 orders in our first months, growing toward 1,000+ per month.
>
> Thank you,
> [Name], BrickWish | [email] | [phone] | [website]
