# TwinECM — full working brief

**What it is:** a mail-in engine computer cloning service. The customer ships a dead
ECM/PCM/ECU; we copy the calibration, VIN, keys and anti-theft onto a working
part-number-matched twin; it ships back plug-and-play with no dealer programming.

**Built by:** Pepito (research) and Tibisay (brand and site), for Juan.
**State as of 2026-09-06:** name decided and cleared, prices decided, identity
recommended, homepage and one vehicle page mocked, launch ads drafted. Not launched.

**Source of record.** Everything below was reconstructed from six artifacts published
2026-09-06. The originals hold the full designs and are the thing to open when you
need the actual HTML:

| Artifact | What it holds |
|---|---|
| [Module Cloning Brand Foundation](https://claude.ai/code/artifact/2e2ac2ae-3697-407a-9e57-905d59b9fc92) | Positioning, customer, naming + clearance, decisions table |
| [TwinECM Logo Directions](https://claude.ai/code/artifact/dc73d182-db61-41bc-ae4f-ebc83d601e8a) | Three logo directions, recommendation |
| [TwinECM Homepage](https://claude.ai/code/artifact/0be124f3-70a0-488f-bf55-5f29785fd0f1) | Homepage, cyan direction, call-first |
| [Coreflash × TwinECM](https://claude.ai/code/artifact/294cfc07-cac7-4661-b2cc-21aef18a5f06) | Alternate homepage, green direction, part-number-first |
| [TwinECM Ram 1500 Page](https://claude.ai/code/artifact/8acf8004-f38e-4a0d-a717-d66a23aff5e7) | Vehicle page, and the template for the other nine |
| [TwinECM Launch Ads](https://claude.ai/code/artifact/cf7a8a75-efe6-4059-be71-92e859326352) | Meta, Google, YouTube, budget calendar |

---

## 1. Positioning

> **Same brain. New board.** Your engine computer, cloned onto a working unit, so it
> plugs in and drives with no dealer visit.

Every competitor sells "cloning." None sell the outcome: the car runs exactly as it
did, for a fraction of the dealer quote, without the owner learning what an
immobilizer is.

**The gap Pepito found:** every competitor makes the customer find the donor. Nobody
advertises "send us your dead computer and we'll find the twin." The most common
question in the forums is "where do I get a donor?" We are the answer.

| | |
|---|---|
| **Path A — Send both** | Customer ships the failed module and a matching donor. This is the whole market today. |
| **Path B — Send one, we find the twin** | Customer ships only the failed module. We source the match. **This is the unoccupied positioning.** |

**Four promises that carry the identity:**

1. **We find the twin.** No junkyard hunting.
2. **Plug and play, guaranteed.** Keys, anti-theft and settings carry over. If it doesn't start, we make it right.
3. **Save the dealer money.** Dealer runs $1,000–$2,500+. Say the numbers out loud on the homepage.
4. **You always know where your computer is.** The badly rated competitors lose on silence and delays. Status updates are the differentiator, not a feature.

## 2. Decisions — locked 2026-09-05

| Decision | Value |
|---|---|
| Name | **TwinECM**, twinecm.com |
| Path A price | **$149** — one price, any car, everything included |
| Path B price | **$299** all-in, module included |
| Turnaround | **One business day** from the day the computer is received |
| Warranty | **Only when TwinECM supplies the module** (Path B). Customer-supplied donors not covered. Length unconfirmed; 12 months assumed. |
| Failed clone | **$59.99** service fee when the original can't be read — **not shown on the site.** The site says only "if we can't clone it, we tell you first," in the footer. |

> **Known inconsistency:** the Brand Foundation's *Positioning* section still carries
> Tibisay's earlier read of "anchor Path A at $249 … Path B at $249 plus donor at
> cost." That was superseded by the decisions table above, and every mockup uses
> $149/$299. The $249 text is stale — fix it if that artifact is reused.

Contact used across all mockups: **+1 (813) 573-3394** · **twinecm@gmail.com** · twinecm.com
Street address and opening hours are placeholders everywhere.

## 3. Customer

The person searching at 11pm is not a technician. Car cranks but won't start, a code
like P0606 or U0100, and a shop that just said "the ECM is gone, that's fifteen
hundred plus programming." Three groups:

- **DIY owners** — can unbolt a module and follow a video. Want a price, a checklist, and proof it will work.
- **Independent shops and mobile mechanics** — don't own a cloning tool. Want fast turnaround, a trade account, and to look good to their own customer.
- **Flippers, salvage rebuilders, used-car lots** — repeat volume, care about pricing and reliability.

All three are on a phone, in a hurry, and skeptical.

**Their words, not ours** (Pepito, from Reddit and competitor reviews): *computer,
brain, PCM, ECM*; it's *fried, shot, bricked, toast*; they want it *preprogrammed*
and *plug and play*; they worry about *anti-theft* and *keys*; they've already been
to the *junkyard*. Use these in headlines. Keep the technical terms for the
part-number field.

- **Top confusion:** "Are PCM and ECM the same thing?" Answer it on the homepage in one line.
- **Top fear:** a used computer won't start the car because the anti-theft lives inside it. This is exactly what cloning solves — first FAQ, and a headline: *"Keep your keys. Keep your settings."*
- **Top objection:** "the computer gets condemned too often, it's usually a wire or a ground." Meet it head on with a "will this fix my problem" page. Honesty here is a trust signal the best competitor already uses.
- **What convinces them:** "plugged it in and it started," "communicated the whole time," "turnaround as promised." That's the review template.

## 4. Competitors

| Competitor | ECM clone | Turnaround | Warranty | Donor |
|---|---|---|---|---|
| UpFix (GA) | $399.99, sale from $499.99 | 3–5 business days | 1 year | Customer |
| FixECM (Canada) | $299 CAD ≈ $220 USD | 1 business day | 12 months | Customer |
| Auto Module Lab (TX) | $250 flat | 24-hour bench | 6 months | Customer |
| Boston ECU Lab (MA) | From $200, quote first | 24–48 hours | Not stated | Customer |
| GoECM (TX) | Repair model, no flat clone price | 2–5 days | Lifetime | N/A |

At $149 we sit under all of them, and Path B has no competitor at all.

**Donor cost and lead time** (Pepito, from eBay, Car-Part and LKQ):

| Family | Used donor | Lead time |
|---|---|---|
| Chevy Silverado / GMC Sierra 5.3, 2010–2013 | $60–120 | 2–5 days |
| Nissan Altima 2.5, 2013–2015 | $15–60 | 2–5 days |
| Ford F-150 5.0, 2011 | $80–150 | 2–5 days |
| Ram 1500 5.7 Hemi, 2014 | $135–175 | 2–5 days |
| Toyota Camry 2.5, 2010–2011 | $30–60 | 2–5 days |
| Discontinued Chrysler, Jeep, some European | Varies, often scarce | 1–3 weeks or unavailable |

Donor cost is low enough that $299 all-in holds margin. **Collect part number and VIN
at checkout** so the donor search starts before the failed unit arrives.

## 5. Name and clearance — checked 2026-09-05

Twelve candidates were generated, all with the .com free. Three shortlisted.

| Name | Verdict | Why |
|---|---|---|
| **TwinECM** | **clearable** | No exact or close mark. Only "TWIN" alone is live, for wipers and brake pads — nothing in the service classes. No business uses it. "Twin ECM" appears only as a generic phrase in dual-engine tuning talk. |
| Ditto Module | caution | "DITTO" is crowded — 27 live marks, one in automotive repair, one for data-copying hardware. |
| Gemelo Auto | blocked | Clear at USPTO, but at least four operating auto businesses already use it (Puerto Rico, Houston). X held by an active detailing shop. |

**Handles:** TikTok and YouTube free. Instagram and X held by dormant accounts with
zero posts.

**Actions:** register the .com; take **@twinecm** on TikTok and YouTube now; use one
fallback pattern on Instagram and X (**@twinecm_official** or **@gettwinecm**) while
requesting the dormant handles through each platform's inactive-username process;
file the trademark as one word in the vehicle repair and data services classes.

> This is research, not legal advice. A trademark attorney should confirm before filing.

Already taken and dropped: moduletwin.com, samebrain.com, echomodule.com, gemelo.com,
clonebay.com, echoauto.com, clonik.com, oneclone.com.

## 6. Identity

The identity **moved between rounds** — this is the single most important thing to
know before reusing any of the mockups.

**Round 1 — "circuit board, not car dealership."** Green solder mask, copper traces,
white silkscreen, part-number stickers. Archivo display type.

| | |
|---|---|
| Trace green | `#1E7A5A` |
| Copper | `#B9722E` |
| Ink | `#151B1A` |
| Board white | `#F3F4F1` |
| Mask tint | `#DDEFE6` |

**Round 2 — dark and electric.** The logo work and every homepage mockup use this
instead:

| | |
|---|---|
| Background | `#0B0E11` (Ram page `#070A0D`) |
| Surface | `#12161B` |
| Line | `#1F262E` |
| Ink | `#E9EDF1` / `#EDF1F5` |
| **Accent cyan** | `#4DE3FF` |
| Warn amber | `#FFB547` |

Type: **Michroma** (display) · **Sora** (body) · **JetBrains Mono** (part numbers,
order numbers, tracking). All Google Fonts, free for commercial use, nothing to
license. Part numbers in mono is the small detail that tells a mechanic we know what
we're doing.

**Three logo directions, one recommendation:**

- **A · Twin bars.** Two identical vertical bars, one solid white, one cyan. Roman numeral II, a pause symbol, and a pair of connector pins at once. Holds from favicon to truck door. *Rule: the accent bar is always the right one.*
- **B · Mirror.** A T reflected across a cyan line. Needs size to read — below ~20px it collapses to a plain I-beam. *Rule: the reflected half is always half opacity.*
- **C · Wordmark.** TWINECM in Michroma, ECM in cyan, one thin HUD underline. Most automotive of the three, reads like a tailgate badge. Needs a separate app icon.

> **Recommendation: Direction A, with C's wordmark rules.** Twin bars beside the name
> set in Michroma, ECM in cyan. One symbol, one typeface, one color.

**Voice:** direct, calm, specific. "Ships back in one business day" beats "fast
turnaround." Never scare, never oversell. Bilingual EN/ES.
**Photography:** real modules on the bench, real boxes with real labels, hands doing
the work. No stock photos of smiling mechanics.

## 7. Site

**The order is the product** — the customer never meets us, so the website is the shop floor.

1. **Check fit** — year, make, model, part number off the sticker. Instant answer plus both prices. "Text us a photo of the sticker" for anyone unsure.
2. **Choose a path** — "I have a donor" or "Find one for me." Path B shows the donor estimate before payment.
3. **Pay and print** — prepaid label and a one-page packing checklist: strong box, anti-static bag, units labeled ORIGINAL and DONOR, VIN and proof of ownership, order confirmation inside. Installments worth offering — "I'm broke and this is $1,000" is a recurring forum line.
4. **Ship** — tracking attached automatically. First status: "We see your package on the way."
5. **We clone** — received, bench-tested, cloned, verified. Each stage is a text and an email. *This is the step the bad competitors get wrong.*
6. **Return** — customer picks return speed at checkout, three flat prices. Every return insured, and the page says so — nobody in the category advertises insurance. Box includes a printed install sheet and the guarantee card.
7. **Plug in and drive** — follow-up two days later: "Did it start?" A yes becomes a review request naming the vehicle and the service.

### Two homepage directions exist, and one has to win

| | Cyan direction | Coreflash direction |
|---|---|---|
| Accent / type | `#4DE3FF`, Michroma + Sora | `#3DE0A0`, Space Grotesk + JetBrains Mono |
| Primary action | **Call (813) 573-3394** — a real person answers | **Type your part number** for an instant price |
| Feel | Consumer, high-contrast, dealer-comparison table | Technical, terminal `bench_clone.log`, grid background |
| Extras | Dealer-vs-us table, "For shops" B2B block, 15 brand tiles | "PCM. ECM. ECU. Same part." block, "Will this fix my car?" two-column, 11-question FAQ |

Both are worth keeping content from — the dealer comparison table and the B2B block
from the cyan one, the "will this fix my car" honesty block and the part-number-first
hero from the Coreflash one.

### Pages that bring the traffic

**Symptom pages first, because nobody searches for cloning.** Five years of Google
Trends: "ECM replacement" averages an index of 35; **"ECM cloning" averages zero and
only registered its first searches in August 2026.** People search the problem, not
our solution. Fastest-rising queries are definitions — "pcm meaning" +350%, "what is
ecm" +50%, "pcm replacement cost" +90%.

Nine launch pages, built from the 60 questions Pepito collected: car won't start ·
stalling and misfires · transmission shifting · check engine light and codes · can I
drive with a bad ECM · replacement cost versus cloning · why a junkyard computer
won't start your car · what is an ECM/PCM/ECU · cloning FAQ. Each gets make variants
like "bad ECM symptoms Chevy Silverado," which is how people actually type it.

**The first ten vehicle families:** Ford F-150 5.4 and 5.0 · Ram 1500 5.7 Hemi ·
Chevy Silverado and GMC Sierra 5.3 · Jeep Grand Cherokee and Wrangler · Nissan
Altima, Sentra and Rogue · Honda Civic · Toyota Camry · Chrysler GPEC2 family ·
Hyundai and Kia. Trucks and Nissan sedans are the volume; European and diesel are the
ticket, and they come second.

**Seasonality:** "ECM replacement" peaks in June, jumps sharply in February, bottoms
out in December and January. Rural truck states over-index — Wyoming, Mississippi,
Oklahoma, West Virginia, Alaska. Volume still lives in Texas, California, Florida.

### The Ram 1500 page is the template for the other nine

Swap the years, part-number rows, sticker location, symptoms, and situation C per family.

| Years | Part numbers start with | What it needs |
|---|---|---|
| 2003–2008 | `56028xxx` (03–05), `05094xxx` (06–08) | Straight clone — not locked |
| 2009–2012 | `05150xxx`, `68xxxxxx` | Straight clone — not locked |
| 2013–2018 | `68153xxx` · `68197xxx` · `68265xxx` · `68298xxx` · `05150797` (manual) | **GPEC2 factory locked** — unlocked on the bench first, no extra charge |

- **Sticker location:** 2009–2018 engine bay, driver side, next to the battery on the inner fender, three bolts, lever-lock connectors. 2003–2008 against the firewall at the base of the windshield, passenger side most years, driver side on 2003.
- **Send the whole part number including the letters** — they're the software level, and AT and MT trucks use different computers.
- **Three bench situations:** (A) original still reads — full copy, most trucks; (B) original is dead — read the memory chip directly off the board, and if even that fails we say so first; (C) 2013–2018 — unlock, then clone.
- **Bench tools named on the page:** OBDSTAR DC706 + P004 adapter · Autotuner · bench harness with a regulated 13.5 V supply.
- **Platform coverage claimed:** GM E38 · Ford PCM · Chrysler NGC and GPEC2 (unlock + clone) · Nissan · Toyota · Honda · Hyundai/Kia · BMW DME/CAS · Mercedes FBS/EIS · EDC15/16/17.

**A clone fixes:** a computer diagnosed as failed · water, heat or voltage damage where
the memory still reads · a used computer that won't start the car because of
anti-theft · a discontinued module with no new part left.
**A clone won't fix:** no-starts from a sensor, fuel, wiring or a bad ground · a
computer completely dead and unreadable · adding new keys or resetting anti-theft on
the car itself · a donor that isn't the same part number.

## 8. Launch marketing

**Nobody is advertising cloning. That is the whole plan.**

- Exactly **one** Meta ad in the entire US mentions ECM cloning — a one-person tuner, started a week ago.
- **UpFix runs about 66 Meta ads. None of them mention ECM or PCM cloning.**
- "pcm replacement cost" and "ECM cloning" are owned by blogs and forums, not by any brand.

Two formats already work here. UpFix: question headline, wallet line, four proof
checkmarks, "stop spending more than you need to." The one cloning ad: symptom
checklist, then "the trap owners fall into" with a junkyard computer, then "that's
exactly what I do." TwinECM combines both, in fewer words.

**Meta — three ads, one message each.** Same structure: a symptom the customer
recognizes, the trap, the fix, proof, one action. Visuals are the twin bars on black
with one line of large type, no stock photos. Each gets an image and a 15-second
video version.

1. **The junkyard trap** — "Dead engine computer? Don't buy a used one." Used computers are locked to the car they came from; the dealer can't program it either.
2. **We find the twin** — "No donor? We find one for you." The only cloning service that sources it.
3. **The dealer quote** — "$1,500 at the dealer. $149 here." Two numbers in Michroma, dealer price struck through. Strongest February–April when tax refunds land, and in June.

Ad 1 has a full Spanish version ("La trampa del yonke") targeting Spanish-language
settings in Texas, California, Florida, Arizona first.

**Google — two ad groups on queries nobody owns.** *Cost* first (most volume, searcher
already has a dealer quote): `pcm replacement cost`, `ecm replacement cost`, `how much
is a new ecm`, `ecm replacement`, `car computer repair`. *Cloning* second (tiny today,
but own it before anyone else): `ecm cloning`, `pcm cloning service`, `ecu cloning
near me`, `clone ecm`, `used pcm won't start`. Add product schema to the service pages
so price and rating show in the result like UpFix's do. Set up a Google Business
Profile with "ECM cloning and repair" in the description.

**YouTube — two videos, three creators.** The biggest competitor-owned video in the
category is a symptom video with 869,000 views; a small shop's own cloning video hit
128,000. Nobody runs pre-roll.

- *Video 1:* "Why your eBay engine computer won't start the car." 90 seconds — the trap on the bench, a clone done on camera, the car starting. Ad 1 in long form.
- *Video 2:* "Is my engine computer actually dead? Five checks before you buy anything." Symptom content pulls the most traffic.

| Creator | Reach | Ask |
|---|---|---|
| Online Mechanic Tips | 269K subs, 417K views on the used-PCM video | Sponsored segment — send a dead module, he films the service end to end |
| Hunt's Workshop | 29.5K subs, runs the free ECM Hub lookup | Partnership — TwinECM as the mail-in option inside ECM Hub |
| Spartan Autoworx | 128K views on its own cloning video | **Study, not sponsor.** Copy the format for Video 1. |

**Calendar:** ramp in February, peak June–August, quiet October–January. Launch
whenever the site is live, but treat the first weeks as a low-spend test — the goal is
learning which ad and which vehicle audiences produce part-number checks, not sales.
Then double the winner, add the Spanish version, and start YouTube outreach so the
videos land before June.

---

## 9. Open items

**Blocking the site going live**
- Street address and opening hours — placeholder on every page.
- Warranty length — 12 months assumed, never confirmed.
- Which homepage direction wins: cyan/call-first or Coreflash/part-number-first.
- A first customer count or a "since 2026" line for the proof row.

**Blocking any ad going live**
- A Meta Business account and a Google Ads account in TwinECM's name.
- Real budget numbers — the $20–30/day Meta and $15–20/day Google figures are placeholders.

**Brand admin, not started**
- Register twinecm.com.
- Claim @twinecm on TikTok and YouTube; pick the Instagram/X fallback and file the inactive-username requests.
- File the trademark, one word, vehicle repair + data services classes, after an attorney confirms.

**Juan must confirm on the bench** — Pepito could not verify these from a page
- Hyundai and Kia module locations.
- OBDSTAR DC706 coverage for Honda and Nissan.
- The Camry fender location.

**Housekeeping**
- The stale $249 pricing text in the Brand Foundation artifact's Positioning section.
- The **TwinECM Homepage** artifact is shared with anyone who has the link, and its share pin is on an older version — outside viewers will not see future publishes until the pin is moved.

**Governance, unresolved**
- `FLEET_RULES.md` scopes the agent fleet to `@juan.rianoo` and puts `@4keyslocksmith` out of scope. TwinECM is a separate business with its own accounts, and the roster does not mention it. Who may post for TwinECM, and under which rules, is not written down anywhere.

**Owed next**
- **Pepito:** competitor ads and keywords; part numbers for the first ten vehicle pages.
- **Tibisay:** the remaining nine vehicle pages off the Ram template; the nine symptom pages; Spanish copy beyond Ad 1; the content calendar.
