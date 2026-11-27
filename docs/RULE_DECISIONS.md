# NEXUS ECLIPSE — CREATOR RULE DECISIONS REGISTER

**Status:** Open for Creator Approval (Gate to Exit R0 → Begin R1)  
**Policy:** No `OPEN` or `PROVISIONAL` mechanic may be silently hardened into canon. Every decision below blocks a specific recovery stage (`R1`, `R2`, `R3`, or `R5`). Reply with your chosen option per ID (e.g., `RD-01: B`, `RD-02: A`, etc.) to unlock implementation.

---

## Gate R1 Decisions — First-Turn Reliability & Core Loop

### `RD-01` — Starting Hand vs. Setup Mandatory Evolution `[CRITICAL · BLOCKS R1]`
- **Problem:** Dealing 3 Minor cards and immediately running mandatory chained evolution can consume all 3 cards before Turn 1 (`eclipse-me-001` leaves Player 1 with `0/5` cards and Rank 6 while Bot holds `3/5` at Rank 1).
- **Options:**
  - **Option A — Refill after setup evolution (with cap):** Deal 3 Minors → run setup mandatory evolution → draw replacement Minors until hand reaches 3 (repeat evolution? Cap setup evolutions at max 1 or 2 steps, OR draw replacement cards that do *not* evolve until Turn 1).
  - **Option B — Clean 3-card non-evolving opening hand *(Recommended)*:** Deal 3 Minors to each player; **if any dealt card would immediately evolve the starting Ace, return it to the Deck of Days and draw another Minor** (re-shuffling returned cards back into Days). Result: **both players guaranteed to start Turn 1 at Rank 1 Ace with exactly 3 playable hand cards**, zero unfair Turn-0 Rank-6 spikes, zero empty hands, 100% card conservation.
  - **Option C — Keep current setup evolution:** Allow Turn-0 auto-evolution to empty hands; rely on UI notice only. *(Not recommended — breaks the 3-playable-cards opening experience.)*
- **Creator Decision:** `PENDING`

### `RD-02` — Maximum Hand Size (`maxHandSize`) `[MEDIUM · BLOCKS R1]`
- **Problem:** Presets currently use `startingHandSize = 3`, `maxHandSize = 5`. Recent playtest feedback requested checking whether the default hand limit should be `3` instead of `5`.
- **Options:**
  - **Option A — `startingHandSize = 3`, `maxHandSize = 5` *(Recommended)*:** Gives room to hold cards claimed from readings for Barrier/Trial sacrifices, elemental actions, and trading without constantly discarding.
  - **Option B — `startingHandSize = 3`, `maxHandSize = 3`:** Tighter hand pressure; claiming any card that doesn't evolve forces immediate discard back to 3.
- **Creator Decision:** `PENDING`

### `RD-03` — Elemental Action Window Timing `[MEDIUM · BLOCKS R1]`
- **Problem:** Milestone D1 placed the optional Elemental Action *after* the encounter; Milestone E moved it *before* Reading (`before_reading`) per creator feedback so players can manipulate the Board/Days before committing to a Reading.
- **Options:**
  - **Option A — `before_reading` as Classic Prototype default *(Recommended)*:** Start of turn = optional Elemental Prep (1 hand card or Reader Bonus) → Reading → Encounter → End Turn.
  - **Option B — `after_encounter`:** Reading → Encounter → Elemental Action → End Turn.
  - **Option C — Flexible (either before OR after, still max 1 per turn):** Allows acting before Reading *or* after Encounter, never both. *(Adds one extra click on turns where you don't use an element.)*
- **Creator Decision:** `PENDING`

### `RD-04` — What Happens After Rejecting the Read Card (`DiscardCenter`) `[AGREED · LOCKED 27 NOV 2026]`
- **Creator Ruling (Overrides Executive Blueprint v0.2 §4.4 per §9 Precedence):**
  - **LOCKED — Option B (Reject & Draw Replacement):** When the active player rejects/discards the read Center card, that card moves **face-up to the Veil** (exposing truthfulness/bluff), the player **receives a new card from Deck of Days** flipped face-up in Center (no second reject), AND **Left Event flips face-up** to determine the encounter reality (Treasure / Barrier / Trial).
  - *Implementation flag:* `replaceCenterOnDiscard: true` on active Classic presets (`false` retained strictly on legacy `poker-proto-c` / `poker-proto-d1` historical baselines).
  - *Side-note on pacing:* Each rejection consumes 1 additional Day from Deck of Days — adding real clock pressure while ensuring no player loses their turn before it begins.
- **Creator Decision:** **`AGREED — OPTION B (LOCKED)`**

### `RD-05` — Reader Bonus Exact Mechanics & Activation Window `[HIGH · BLOCKS R1]`
- **Creator Input (`27 Nov 2026`):** Locking the bonus strictly to the next turn's opening prep feels disconnected from earning it. Wants Reader Bonus to feel **usable whenever you hold an elemental bonus**, with **explicit element-specific actions** (e.g., *Air: shuffle 1 Board card or 1 card in the Immediate Future (top 3 of Days)*; *Water: resurface 1 card from Veil*; *Fire: burn 1 card from Board or Immediate Future*; *Earth: reorder 1 card from Board or Immediate Future*).
- **Sub-decisions to lock:**
  1. **When can you activate a Reader Bonus?**
     - **Option A — Anytime during YOUR turn *(Recommended for clean multiplayer/bot flow)*:** Bonus unlocks immediately when earned and stays available across your entire next turn (before Reading, during Reading decision, or before End Turn — never locked out just because you clicked `Proceed to Reading`). Zero opponent-turn interruption.
     - **Option B — Immediate Reaction Window when earned (OR Bank for your turn):** Right after the reading resolves on the other player's turn, Reader gets a quick prompt (`Use Bonus Now` / `Bank for My Turn`). More reactive, but adds a pause during Bot's turn (and future multiplayer handoffs).
  2. **On `BAD` advice + Reject/Replace (`RD-04`), which card grants the Reader Bonus?**
     - **Option A — Discarded Card 1 immediately on Reject *(Recommended — matches "the opinion is about that card")*:** Reader advised `BAD` on Card 1; player followed that opinion and sent Card 1 to Veil → Reader immediately earns Card 1's element bonus regardless of what happens to replacement Card 2.
     - **Option B — Replacement Card 2 only if claimed:** Reader earns Card 2's element only if the active player reconciles and claims Card 2.
  3. **GOOD → PURSUE → ABANDON:** Withhold bonus (`false`, *recommended*) vs. Grant on Pursue (`true`).
  4. **Action Budget:** Does spending a Reader Bonus consume your 1 normal hand-card elemental action (`true`), or is it a **separate free bonus action** (`false`, *recommended*)?
  5. **Expiry:** Expires if unused at the end of your next turn (*recommended*) vs. persists indefinitely until spent (max 1 banked).
- **Creator Decision:** `PENDING`

### `RD-09` — Earth Inspection Visibility & Air/Fire/Earth "Immediate Future" Scope `[HIGH · BLOCKS R1]`
- **Creator Input (`27 Nov 2026`):** The top 3 cards (`#1–#3`) of Deck of Days are formally **`The Immediate Future`** (bordered in the Deck browser, `#1` labeled `Next Upcoming`).
- **Sub-decisions to lock:**
  1. **Earth Reordering Visibility:**
     - **Option A — Private temporary peek on Earth activation *(Recommended)*:** Consuming an Earth card (`strength = 1..3`) or Earth Reader Bonus privately reveals the top `strength` cards of the Immediate Future **only to the active player** (`AWAITING_EARTH_REORDER`), lets them arrange exact order, and confirms (zero leakage to opponent).
     - **Option B — Earth targets Board only unless Reflection/top-reveal is active.**
  2. **Air Shuffle Scope on Deck of Days:**
     - **Option A — Shuffle selected Board card(s) and/or top `strength` Immediate Future cards into the full Deck of Days *(current behavior)*.**
     - **Option B — Shuffle strictly within the Immediate Future (top 3 cards) when targeting Days**, leaving cards `#4..#N` untouched.
- **Creator Decision:** `PENDING`

### `RD-15` — Turn-1 3-Card Board & Right-Slot (`Parallel`) Minor Card Lifecycle `[CRITICAL · BLOCKS R1/R2]`
- **Creator Ruling (`27 Nov 2026`, AGREED):** Turn 1 draws **3 cards** across all 3 Board slots (`Event`, `Center`, `Parallel`), NOT 2. Leaving Parallel empty until a Major surfaces becomes an optional setting: `emptyChamberMode` (default `false`).
- **Open Mechanical Question:** When `emptyChamberMode = false` and a **Minor card** sits in the rightmost (`Parallel`) slot, how does it move on subsequent turns?
  - **Option A — 3-Slot Conveyor Slide (`Deck → Right → Center → Left Event → Veil`) *(Recommended)*:**
    - Turn 1 deals 3 face-down cards: `Left Event`, `Center` (read this turn), and `Right` (next turn's incoming card — face-down if Minor so it doesn't spoil the next reading, face-up if Major/Court!).
    - At turn refresh, resolved `Left Event` → Veil; **`Right` slides left into `Center` (or `Left Event`)**, and 1 fresh card is drawn from Deck of Days into `Right`!
    - *Note:* If a **Major/Court** lands in `Right` (or slides), specify whether it stays anchored in `Right` while Minors flow into `Event`/`Center`, OR slides with the conveyor (which naturally enables Eclipse & Triangulation!).
  - **Option B — Right holds next turn's Left Event (`Right → Event`), while Center draws fresh from Days:** Right is face-down "next Event", keeping Center readings fresh from Days.
  - **Option C — Right is a live face-up/face-down 3rd Board card targetable by Air/Fire/Earth, cycling to Veil at end of turn:** Faster deck burn; no sliding queue.
- **Creator Decision:** `PENDING`

---

## Gate R2 Decisions — Classic Courts, Eclipse & Intentional Triangulation

### `RD-06` — Classic Court Arrival, Dormancy, Active Buff & Contention Lifecycle `[CRITICAL · BLOCKS R2]`
- **Problem:** Current `majors.ts` overflows drawn Courts automatically across `Parallel → Event → Center`, causing 88% automatic Triangulation wins in ~8 turns, while dormancy has no mechanical effect and Courts grant no active board buff.
- **Options:**
  - **Option A — Dedicated Parallel Slot + 1-Turn Dormancy + LIFO Contention (`Rank 7+` chooses) *(Recommended)*:**
    - Newly drawn Courts ALWAYS route to **Parallel Dimension** (never auto-overflowing into Event or Center!).
    - A newly arrived Court is **dormant for 1 full turn** (no active buff while dormant).
    - While active, a Court grants its Classic bonus (`J +1 / Q +2 / K +3` to matching-element reconciliation/effects, subject to `maxEffectiveVP` cap).
    - **Contention:** When a new Court arrives while Parallel already holds a Court:
      - First check if the arriving Court + existing Board Court form a **Classic Eclipse** (opposite-color same rank, e.g. `K♠ + K♥`) → if so, **Eclipse triggers immediately!** (Active player claims persistent `+1/+2/+3` Eclipse credit, both Courts move to Veil.)
      - Otherwise, **Major Contention** resolves: if active player is **Rank 1–6**, **LIFO** applies (existing Parallel Court exits to Veil, newcomer takes Parallel dormant 1 turn); if active player is **Rank 7–9**, engine pauses in `AWAITING_MAJOR_CONTENTION` (`ChooseMajorExit`) so player chooses which Court stays and which exits to Veil!
    - Optional: Should `Parallel` hold **up to 2 Courts** (1 Active + 1 Dormant) before LIFO contention triggers so Eclipses can form naturally between two consecutive drawn Courts? **Yes — strongly recommended** (without 2 slots or paired check on arrival, opposite-color same-rank pairs would never coexist long enough to Eclipse!).
  - **Option B — Separate Active Altar (up to 2) + Dormant Parallel Queue:** Similar to Option A, visually separating dormant arriving Court from active Board Court(s).
- **Creator Decision:** `PENDING`

### `RD-07` — How Triangulation (3 Majors on Event + Center + Parallel) Becomes Possible in Classic Mode `[CRITICAL · BLOCKS R2]`
- **Problem:** Once Option A above stops automatic overflow into Event and Center, **how** can three Courts legally occupy `Event`, `Center`, and `Parallel` simultaneously to achieve Triangulation? (GDD §16 calls this *"the single most important spatial-rules gap"*.)
- **Options:**
  - **Option A — Intentional Placement via Elemental Action / High-Rank Control *(Recommended for Classic)*:**
    - Natural draws only place Courts into `Parallel` (never auto-filling Event/Center).
    - A player engineers Triangulation deliberately by:
      1. Keeping an active Court in `Parallel` (or two via contention timing), AND
      2. Using **Water (tier 3 / 3 VP)** to resurface a Court from the Veil onto an open Board slot (`Event` or `Center`), OR **Earth (tier 2–3)** to reposition a Court onto Event/Center, OR **Rank 7–9 Contention** allowing a contending Court to be *pinned* onto Event/Center instead of discarded!
    - Result: Triangulation becomes a deliberate, dramatic late-game win (~5–15% of games) instead of an 88% turn-8 accident.
  - **Option B — Keep Courts in Parallel/Eclipse only for Classic; defer Triangulation to R5 (`Death/Rebirth` + `Merkabah`):** Classic mode wins via Eclipse (`players + 1`) or Days exhaustion; Triangulation unlocks with bespoke Sun/Moon Majors in R5.
- **Creator Decision:** `PENDING`

### `RD-08` — Classic Court Active Buff Interaction with `maxEffectiveVP = 3` `[MEDIUM · BLOCKS R2]`
- **Problem:** If a King (`+3`) is active on Board and `maxEffectiveVP = 3`, a player at Rank 1 (`1 VP`) + King (`+3`) hits the cap immediately; a player at Rank 7 (`3 VP`) gains `+0` net VP from the King unless Eclipse/Court bonuses either bypass or raise the cap slightly.
- **Options:**
  - **Option A — Strict `maxEffectiveVP = 3` cap on everything:** Keeps introductory math flat (`1–3`); Courts mainly help low-rank players pass Barriers/Trials without sacrificing cards.
  - **Option B — Separate `maxBaseVP = 3` from persistent Eclipse bonus (`+1/+2/+3`):** Minor cards & lineage stay capped at 3, while earned Eclipses give tangible progression advantage.
- **Creator Decision:** `PENDING`

---

## Gate R3 Decisions — Trading Market & Endings

### `RD-10` — Trading Market Cadence & Bot Negotiation Policy `[HIGH · BLOCKS R3]`
- **Options:**
  - **Cadence:** Open after **every 2nd round** (`marketFrequencyRounds = 2`, *recommended* per GDD §15 hypothesis #4) vs. after **every round** (`1`).
  - **Offer types:** Allow 1-for-1, multi-card uneven trades, and 1-way gifts (`[AGREED]`).
  - **Bot negotiation policy:** Fair masked-view evaluator that accepts trades improving its evolution proximity or VP balance (never peeking at hidden Days or Human's unoffered cards).
  - **Max offers per market window:** Cap at `2` proposals per player per market window so markets stay brisk (`[PROVISIONAL]`).
- **Creator Decision:** `PENDING`

### `RD-11` — "Winner of the Day" Tie-Break on Deck Exhaustion `[MEDIUM · BLOCKS R3/R4]`
- **Options:**
  - **Option A — Eclipse Count → Lineage Rank → Evolutions Completed → Shared *(Recommended)*:** Rewards pursuing the primary Eclipse objective first, then personal growth.
  - **Option B — Lineage Rank → Eclipse Count → Shared:** Pure personal evolution honor per GDD §9.3 (*"strongest evolved player"*).
- **Creator Decision:** `PENDING`

### `RD-12` — Trial Formula Confirmation `[LOW · ALREADY IMPLEMENTED PROVISIONALLY]`
- Currently: compares against **Left Event element** (`Water > Fire > Earth > Air > Water`), requires at least 1 advantageous card (lineage or sacrifice), grants `+1 VP` once, must strictly exceed Event VP (`> 1`), capped at `maxEffectiveVP = 3`.
- **Decision needed:** Confirm as **`[AGREED]`** for Classic mode, or request adjustment.
- **Creator Decision:** `PENDING`

---

## Gate R5 Decisions — Future Sun/Moon Major Arcana (Deferred Until After R4)

### `RD-13` — Sun/Moon Eclipse Pairing Rule `[OPEN · DEFERRED TO R5]`
- What exact pairs among the 18 numbered Sun/Moon Majors form a Sun/Moon Eclipse (e.g., matching number Sun `N` + Moon `N`, or specific thematic pairs)? Do repeated Eclipses stack Champion bonuses or only increment `eclipseCount`?

### `RD-14` — Moon (0) Entropy Duration & Sun (0) Rescue Condition `[OPEN · DEFERRED TO R5]`
- Exact number of turns/actions during Moon Entropy, legal actions (trading/elemental), exact rescue condition (Eclipse or Triangulation), and Board/Hand disposition on Sun Renewal.
