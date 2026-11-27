# NEXUS ECLIPSE — AUTHORITATIVE GAMEPLAY CONTRACT

**Status:** Phase 0 Source-of-Truth Contract (Recovery Stage R0)  
**Repository:** `johnmogi/nce-eclipse`  
**Audit Baseline Commit:** `0f13de4` (`feature/d1-elemental-gameplay`, PR #1; `origin/main` preserved at `f08d169`)  
**Rule Classification Legend:**
- **`[AGREED]`** — Explicitly confirmed by creator or canon across source documents; engine and UI must enforce verbatim.
- **`[PROVISIONAL]`** — Concrete playtest default implemented behind a configurable ruleset flag; editable pending creator sign-off.
- **`[OPEN]`** — Unresolved design rule; must **not** be silently promoted to canon. See [`docs/RULE_DECISIONS.md`](./RULE_DECISIONS.md).

---

## 0. Source-of-Truth Inventory & Precedence

### Verified Source Documents Read
1. **Creator's latest explicit rulings in conversation** *(highest precedence)*:
   - Elemental activation consumes the source hand card → Veil (`D1`, confirmed).
   - Water cannot resurface its own activating card during the same action (`D1`, confirmed).
   - Elemental prep timing requested before Reading (`Milestone E`, confirmed intent — interaction with turn-start refill pending sign-off).
   - Starting experience must provide 3 playable hand cards (`Playtest feedback`, requires setup rule lock in `RD-01`).
   - Classic prototype must be distinguishable from bespoke Sun/Moon Major Arcana.
   - **Deck of Days "Immediate Future" UX (`27 Nov 2026`, confirmed):** Deck browser reads left-to-right; card `#1` is labeled **`Next Upcoming`** (not `Top`), and cards `#1–#3` are visually bordered as **`Immediate Future (Next 3 Cards)`**.
   - **Turn 1 populates all 3 Board slots (`27 Nov 2026`, confirmed):** Turn 1 deals **3 cards** across `Event`, `Center`, and `Parallel` (not 2); keeping Parallel vacant until a Major surfaces is an optional `emptyChamberMode` setting (default `false`).
   - **Flexible Reader Bonus timing & explicit element actions (`27 Nov 2026`, direction confirmed; exact interrupt window in `RD-05`).**
2. **Executive Blueprint v0.2** (`26 Nov 2026`, Milestone C handoff / rules contract) — **Present & verified.**
3. **Game Design Document (GDD) v0.1** (`26 Nov 2026`, player-facing design & lore) — **Present & verified.**
4. **Developer Specification Blueprint v0.1** (`26 Nov 2026`, domain model & NCE architecture) — **Present & verified.**

### Missing or Non-Canonical Sources (Reported Explicitly)
- **No core source documents are missing.** All three canonical v0.1/v0.2 documents were read directly.
- **Superseded draft warning:** An earlier pre-NCE workspace artifact (`ECLIPSE_L1_MVP_GDD.md`, `25 Nov 2026`) exists in conversation history with conflicting rules (optional evolution button, Altar zone, reject-and-draw replacement, Earth hand-swap). It is **not canonical** and must not be mixed with GDD v0.1 / Blueprint v0.1 / Executive Blueprint v0.2 unless the creator explicitly adopts a specific mechanic via `RULE_DECISIONS.md`.

---

## 1. Deck Composition, Suits, Value Points & Advantage Cycle

- **Suits / Elements / Colors `[AGREED]`:**
  - `♠ Spades` = **Air** (Black)
  - `♣ Clubs` = **Fire** (Black)
  - `♥ Hearts` = **Water** (Red)
  - `♦ Diamonds` = **Earth** (Red)
- **Value Points (VP) `[AGREED]`:**
  - Ranks `Ace (1)–3` = **1 VP**
  - Ranks `4–6` = **2 VP**
  - Ranks `7–9` = **3 VP**
  - VP is a tier distinct from printed rank.
- **Elemental Advantage Cycle `[AGREED]`:**
  - `Water > Fire > Earth > Air > Water`.
  - Non-adjacent / same-element matchups grant **0 extra advantage**.
- **Deck Profiles `[AGREED]`:**
  - **Classic 36-Minor Baseline (`classic-36`):** 36 Minors (`Ace–9` × 4 suits; Tens removed). Used in Milestones C & D1.
  - **Classic 48-Card Prototype (`classic-48`):** 36 Minors + **12 Classic Courts (`J` Prince +1 / `Q` Queen +2 / `K` King +3)** acting strictly as **Major Arcana proxies** for classic balance testing.
  - **Sun/Moon Full Deck (`sun-moon`, Future R5):** 20 bespoke Major Arcana (`Sun 0–9` + `Moon 0–9`, where `Sun 0` and `Moon 0` are outside the ordinary Days draw). **Not implemented yet**; UI must never label Classic Courts as Sun/Moon Major Arcana.
- **Global Effective VP Cap `[PROVISIONAL]`:** `maxEffectiveVP = 3` in introductory presets, tracked separately from physical card-movement multipliers (e.g., future Split Moon Tower).

---

## 2. Initial Setup & Opening Hand

1. **Primary Aces `[AGREED]`:** Each player begins with a distinct elemental Ace (`Rank 1`, `1 VP`) as their permanent primary identity (`primaryElement`, `primaryAceCard`). Unused Aces remain out of play in Reserve (`unusedAcesInDeck = false` `[PROVISIONAL]`).
2. **Deck Shuffle `[AGREED]`:** Remaining cards are shuffled deterministically from `(ruleset.id, ruleset.version, seed)`.
3. **Starting Hand Deal `[AGREED target / OPEN evolution interaction]`:**
   - Each player is dealt **3 Minor cards** (`startingHandSize = 3`). Any Courts/Majors encountered during starting hand deal are re-shuffled back into Deck of Days so players never hold Majors in hand.
   - **CRITICAL OPEN CONFLICT (`RD-01`):** Currently `setup.ts` runs mandatory chained evolution immediately on the dealt 3-card starting hand. On seeds like `eclipse-me-001`, all 3 cards (`3♠, 4♠, 6♣`) are immediately consumed into lineage before Turn 1, leaving Player 1 with **0 playable cards** while Bot holds 3. **Creator must approve `RD-01`** (e.g., refill hand back to 3 after setup evolution with a chain safeguard, or defer evolution until Turn 1).
4. **Hand Size Limit `[OPEN — RD-02]`:**
   - Currently `maxHandSize = 5` across presets (`[PROVISIONAL]`). Creator feedback on Turn 1 requested investigating `3` vs `5` as default hand limit. Requires explicit lock in `RD-02`.
5. **Initial Board Setup `[AGREED 3-card start / OPEN slide rule RD-15]`:**
   - **Default (`emptyChamberMode = false` `[AGREED]`):** Turn 1 populates **all 3 Board slots** (`Event`, `Center`, and `Parallel`) with 3 drawn cards so the Right chamber is not left empty.
   - **Optional setting (`emptyChamberMode = true` `[PROVISIONAL]`):** Leaves Right Parallel vacant at setup and until a Major surfaces (configurable in Rules/Lab).
   - **OPEN (`RD-15`):** Exact lifecycle of a Minor card sitting in the Right (`Parallel`) slot (e.g., face-down conveyor slide `Parallel → Center` vs `Parallel → Event` on turn refresh, and how arriving Majors interact with that slide) must be locked before R1/R2 implementation.

---

## 3. Primary Ace & Mandatory Chained Evolution

- **Compulsory Growth `[AGREED]`:** Whenever a qualifying card enters a player's hand (via claim, trade, or connected access), it **automatically** advances the player's lineage. Players can never decline an eligible evolution to save a card for hand effects or trading.
- **Progression Rules `[AGREED]`:**
  - **Basic / Standard Mode:** Same **color**, rank `+1` or `+2`.
  - **Hard / Strict Mode:** Same **element**, rank `+1` only.
- **Chaining `[AGREED]`:** Evolution repeats automatically until no eligible card remains in hand.
- **Simultaneous Tie-Breaker `[PROVISIONAL]`:** When multiple cards qualify simultaneously, advance using lowest legal rank first, preferring same element on rank ties (`evolutionTieBreak = 'lowest-rank-same-element'`).
- **Permanent Primary Identity `[AGREED]`:** Even after lineage evolves (e.g. `A♠ → 8♣`), the player's original Primary Ace (`A♠ · Air`) remains permanently visible and governs primary-element identity (and future Champion mapping).

---

## 4. Full Turn Sequence & Exact Phase Transitions

### Agreed Core Non-Negotiables
1. **Reading ≠ Decision ≠ Outcome `[AGREED]`:** Advice (`GOOD`/`BAD`), player decision (`PURSUE`/`DISCARD`), and reality outcome (`claimed`/`discarded`/`abandoned`) are recorded separately.
2. **Left Event sets reality & threshold, never Center `[AGREED]`.**
3. **Max 1 elemental hand action per turn `[AGREED]`.**

### Turn Sequence (Pre-Reading Elemental Prep — Milestone E / Classic Target) `[PROVISIONAL — RD-03]`
1. **Start of Turn (`START_TURN` / automatic transitions):**
   - Activate any dormant Major whose 1-turn dormancy completed.
   - Ensure Left Event and Center are populated (unless Center holds a face-up Abandoned card from prior turn).
   - Enter **`AWAITING_ELEMENTAL_ACTION`** (Optional Pre-Reading Elemental Prep): player may activate 1 hand card OR spend an eligible Reader Bonus, OR click `AdvanceToReading`.
2. **Abandoned Opportunity Check (`AWAITING_ABANDONED_CHOICE`) `[AGREED]`:**
   - If the previous player abandoned Center on a Barrier/Trial, the active player may **claim it freely as Treasure** (skipping their normal reading) OR **decline it** (`send_to_veil` `[PROVISIONAL]`, then draw a fresh concealed Center for Reading).
3. **Private Reading (`AWAITING_READING`) `[AGREED]`:**
   - Designated Reader (clockwise next player; autonomous Bot in Human vs Bot) privately inspects concealed Center and advises **`GOOD`** or **`BAD`** (may bluff).
   - Canonical tier/color hints remain disabled by default (`readingTierHintsEnabled = false` `[PROVISIONAL]`).
4. **Active Player Reading Choice (`AWAITING_READING_DECISION`) `[AGREED core / OPEN BAD-replacement RD-04]`:**
   - **`PursueCenter`:** Reveals Center and Left Event → enters **`AWAITING_EVENT_RESOLUTION`**.
   - **`DiscardCenter`:** Reveals Center into the public Veil (exposing truthfulness/bluff) and evaluates Reader Bonus.
     - **OPEN (`RD-04`):** Under Executive Blueprint v0.2, `DiscardCenter` ends the encounter for the turn (no replacement draw). Creator feedback also asked whether discarding after `BAD` advice should draw a fresh card. Must be explicitly locked in `RD-04`.
5. **Event Resolution (`AWAITING_EVENT_RESOLUTION`) `[AGREED]`:**
   - **Treasure (Left 7–9 / 3 VP):** Claim Center freely (no sacrifice permitted).
   - **Barrier (Left 4–6 / 2 VP):** Reconcile with `effectiveVP >= 2` (lineage VP + sacrificed hand cards, subject to cap) OR **`AbandonCenter`**.
   - **Trial (Left 1–3 / 1 VP):** Reconcile with `effectiveVP > 1` **AND** elemental leverage OR **`AbandonCenter`**.
   - On Claim: Center enters hand → immediate **Mandatory Chained Evolution**.
   - On Abandon: Center stays face-up on Board for next player; resolved Left Event moves to Veil.
6. **Hand Limit & Turn Cleanup (`AWAITING_HAND_DISCARD` → `READY_TO_END_TURN` → `EndTurn`):**
   - If hand exceeds `maxHandSize`, discard excess to Veil.
   - Unused Reader Bonuses eligible this turn expire at `EndTurn` (`[PROVISIONAL — RD-05]`).
   - Unused concealed Left Event after `DiscardCenter` rotates to Veil (`rotateEventOnCenterDiscard = true` `[PROVISIONAL]`).
   - Check round boundary → open **Trading Market** when scheduled (`R3`).
   - Advance turn, refill empty Board slots, check completion / exhaustion.

---

## 5. Reader Roles, Advice, Bluffing & Elemental Rewards

- **Reward Trigger `[AGREED]`:** Reader earns a bonus when the active player **follows** their advice, **regardless of truthfulness**:
  - `BAD` advice + `DiscardCenter` → **Grants bonus.**
  - `GOOD` advice + `PursueCenter` + **Claim** → **Grants bonus.**
  - Advice not followed (`GOOD` + `Discard`, `BAD` + `Pursue`) → **Withheld.**
- **GOOD → PURSUE → ABANDON Policy `[PROVISIONAL — RD-05]`:** Currently withheld (`readerBonusOnAbandon = false`) per Executive Blueprint v0.2 interim guidance; configurable and awaits creator lock.
- **Bonus Form, Element, Timing & Expiry `[PROVISIONAL — RD-05]`:**
  - Currently implemented as `free_tier1_elemental_next_turn`: a free **Tier 1 (1 VP)** elemental action matching the resolved Center card's element, consuming **0 hand cards**, usable on the Reader's next turn during `AWAITING_ELEMENTAL_ACTION`, consuming the turn's 1-elemental-action slot (`readerBonusConsumesTurnAction = true`), and expiring if unused at end of that turn.
  - Needs explicit creator confirmation on: (a) source element (resolved Center card), (b) strength (Tier 1), (c) whether it consumes the normal 1-per-turn elemental slot, and (d) expiry window.

---

## 6. Event Realities, Reconciliation & Sacrifice

- **Event Reality Mapping `[AGREED]`:** Always derived from Left Event card, never Center (`7–9` Treasure, `4–6` Barrier, `1–3` Trial).
- **Barrier Math `[AGREED]`:** `effectiveVP = min(maxEffectiveVP, lineageVP + sacrificedVP) >= eventVP`.
- **Trial Math `[PROVISIONAL — RD-12]`:**
  - Compares participating cards (`[lineageTopCard, ...sacrificedCards]`) against **Left Event element** (`trialTargetElement = 'event'`).
  - Requires at least one participating card beating Left Event under `Water > Fire > Earth > Air > Water` (`trialRequireAdvantage = true`).
  - Grants `+1 VP` leverage **once** (`trialAdvantageBonusVP = 1`), capped by `maxEffectiveVP = 3`. Must strictly exceed Event VP (`effectiveVP > 1`; equal fails).
- **Sacrifice Destination `[PROVISIONAL]`:** Public Veil (`sacrificeDestination = 'veil'`).

---

## 7. Elemental Hand Effects & Visibility Integrity

- **Activation Cost `[AGREED]`:** Selecting 1 card from hand consumes that card atomically from **Hand → Veil**. Strength = consumed card's original VP (`1–3`, no silent `VP+1` scaling). Counts toward max 1 elemental action per turn.
- **Validation Atomicity `[AGREED]`:** Every target/zone constraint is validated *before* mutating state; invalid commands never consume the card.
- **Four Elemental Verbs `[AGREED core / OPEN Earth inspection & Immediate Future scope RD-09]`:**
  - **Immediate Future `[AGREED terminology]`:** The top 3 cards (`#1–#3`) of Deck of Days are formally named **the Immediate Future**, visually bordered in the Deck browser with `#1` labeled **`Next Upcoming`** and clear left-to-right draw flow.
  - **Air `♠` (Shuffle):** Shuffles up to `strength` cards from Board (`event`/`center`/`parallel`) and/or the **Immediate Future** (top 3 of Deck of Days) unpredictably. *(Exact shuffle scope — into full Deck vs within Immediate Future — locked in `RD-09`.)*
  - **Fire `♣` (Burn):** Sends up to `strength` cards from Board (`event`/`center`/`parallel`) and/or the **Immediate Future** (top of Deck of Days) directly to the Veil.
  - **Water `♥` (Resurface):** Returns `1..strength` cards from Veil → Deck of Days (`shuffled` default `[PROVISIONAL]`; `top`/`bottom` configurable).
    - **Self-resurface prohibition `[AGREED]`:** The consumed Water card is strictly excluded from eligible Veil targets during the same activation (`WATER_SELF_RESURFACE_FORBIDDEN`).
  - **Earth `♦` (Reorder):** Deliberately repositions up to `strength` cards on Board and/or the **Immediate Future** (top of Deck of Days).
    - **CRITICAL OPEN DEFECT (`RD-09`):** Currently, player views mask all Deck of Days cards (`daysCards: null`), so the Earth UI asks players to reorder identical face-down backs (`Orig #1 / Orig #2 / Orig #3`). Without a private temporary peek at the top `strength` cards during Earth activation, Earth cannot provide *deliberate* control distinct from Air's shuffle. Creator must lock `RD-09`.
- **Pre-Reading Board Refill `[PROVISIONAL]`:** If pre-reading Air/Fire/Earth clears Event or Center, `AdvanceToReading` refills the empty slot before Reading begins (triggering combo checks if a Major arrives).

---

## 8. Deck of Days & Veil Visibility vs Access

- **Separation of Visibility and Access `[AGREED]`:**
  - `zoneVisibility`: `'full' | 'top_only' | 'hidden'` (per zone). Baseline: `days = 'hidden'`, `veil = 'full'`.
  - `zoneAccess`: `{ canInspectDays, canManipulateDays, canInspectVeil, canResurfaceFromVeil }`.
  - Hidden does **not** automatically mean inaccessible (e.g., future Moon Reflection hides deep Veil visually without blocking Water retrieval); access-locked does **not** automatically mean face-down (e.g., future Garden Gates locks deep access).
- **Hidden Information Guarantees `[AGREED]`:**
  - Player views and player exports **never** expose deterministic `seed`, opponent hand contents, concealed Center (except to Reader), concealed Left Event, or hidden Days order.
  - Bot controller operates **exclusively** on masked `ProjectedGameView` for its own `playerId` and throws if handed an Admin view.

---

## 9. Major Arcana Arrival, Dormancy, Contention & Departure

### Critical Separation `[AGREED]`
- **Classic Prototype (R2):** Uses **12 Classic Courts (`J/Q/K` across 4 suits)** as Major Arcana proxies.
- **Sun/Moon Expansion (R5):** Uses **20 bespoke Sun/Moon Major Arcana** (18 numbered + `Sun 0` + `Moon 0`). Deferred until R4 passes.

### Established Principles `[AGREED intent / OPEN mechanics RD-06 & RD-07]`
1. Newly encountered Majors have distinguishable backs (`backGroup: 'major'`), route into **Right · Parallel Dimension**, and remain **dormant for 1 turn** before becoming active.
2. While active on the Board, Classic Courts provide elemental bonuses (`J +1 / Q +2 / K +3` `[PROVISIONAL]`).
3. When multiple Majors contend for Parallel Dimension, default departure priority is **LIFO (last-in, first-out)** `[AGREED baseline]`, except a player at **Lineage Rank 7–9** may choose which Major stays or exits (`ChooseMajorExit` `[AGREED intent / OPEN exact flow]`).
4. **CRITICAL CURRENT DEFECT (`RD-06` & `RD-07`):** Current `src/engine/majors.ts` bypasses contention/LIFO entirely and automatically overflows drawn Courts into `Parallel → Event → Center`, causing **87.8% accidental Triangulation wins in ~8.28 turns** and leaving Courts stuck in Left Event while dormancy has zero mechanical effect. Must be redesigned and approved in `RD-06` / `RD-07` before R2 implementation.

---

## 10. Eclipse Formation, Rewards & Victory

- **Classic Eclipse `[AGREED]`:** Opposite-color Classic Courts of the **same rank** (`J/Q/K`) simultaneously present in the active Major space form an **Eclipse**.
- **Classic Reward `[AGREED core / PROVISIONAL stacking]`:** Grants persistent personal acquisition (`J +1 / Q +2 / K +3`) beside the player's Ace, retained after the Courts exit the Board.
- **Victory Threshold `[PROVISIONAL]`:** `players + 1` (3 Eclipses in 2P) in standard mode; `1` Eclipse in quick/training mode.
- **Sun/Moon Eclipse `[OPEN — R5]`:** Grants player's primary-element Champion (`Daydreamer` Air / `She-Man` Fire / `Lucid Dreamer` Water / `Wise` Earth). Exact Sun/Moon pairing rule remains `[OPEN]`.

---

## 11. Triangulation Formation & Victory

- **Definition `[AGREED]`:** Three Major Arcana simultaneously occupying all three Board positions (`Event`, `Center`, `Parallel`).
- **Central Check `[AGREED]`:** `evaluateCombos()` runs after **every** Board mutation (draws, elemental effects, resurfacing), never draws alone.
- **Achievability Requirement `[OPEN — RD-07]`:** Triangulation must be a **rare, intentional, high-agency achievement** (e.g., engineered via Elemental manipulation, deliberate Major placement, or future Death/Rebirth) — **never** an automatic 88% draw accident. Exact legal path for 3 Majors to occupy Left, Center, and Right in Classic mode must be locked in `RD-07`.

---

## 12. Trading Market & Bot Negotiation

- **Core Rules `[AGREED]`:** Freeform, consensual exchange (1-for-1, uneven, or gifts); no automatic enforceable bluff debt; mandatory chained evolution runs immediately on received cards for both participants.
- **Cadence `[PROVISIONAL — RD-10]`:** Opens between rounds (`marketFrequencyRounds = 1` or `2`; currently `0` / disabled). Future `Shekhinah` overrides to every turn.
- **Current Status:** Not implemented (`ProposeTrade` / `AcceptTrade` gated by `tradingMarket: false`). Scheduled for **R3** after `RD-10` is locked.

---

## 13. Game Completion & Deck of Days Exhaustion

- **Classic Mode Endings `[AGREED core / OPEN tie-break RD-11]`:**
  1. **Eclipse Victory:** Player reaches `requiredEclipses`.
  2. **Triangulation Victory:** Active player aligns 3 Majors across all 3 Board slots.
  3. **Deck of Days Exhausted:** Collective time exhaustion; engine also records individual **"Winner of the Day"** (`[OPEN tie-break: RD-11]`: highest lineage rank → Eclipse count → shared).
- **Sun/Moon Mode (`R5`) `[OPEN]`:** Deck exhaustion enters **Moon (0) Entropy / Nexus Point**; successful rescue triggers **Sun (0) Renewal** returning Veil → Days while preserving lineage and Champions.

---

## 14. Phase 1 — Code-to-Contract Compliance Matrix

| # | Rule / Area | Expected Behavior (Contract) | Current Code Behavior | Source File / Function | Severity | Required Correction | Deterministic Acceptance Scenario |
|---|---|---|---|---|---|---|---|
| **C1** | **Starting Hand (`RD-01`)** | New game begins with 3 playable hand cards while preserving mandatory evolution & card conservation. | Deals 3 Minors then immediately runs `applyEvolutionWithEvents()`; on `eclipse-me-001`, all 3 cards auto-evolve (`A♠→3♠→4♠→6♣`), leaving Player 1 with **0 hand cards** before Turn 1. | `src/engine/setup.ts` (`createGame`, lines 159–212) | **Critical** | Implement approved `RD-01` rule (e.g., refill-to-3 with safeguard or post-setup evolution) + hard invariant test across 500 seeds. | `eclipse-me-001` & 500-seed suite: both players start Turn 1 with `hand.length === 3` and exact 48-card conservation. |
| **C2** | **Major Overflow & Triangulation (`RD-06`, `RD-07`)** | Majors route to Parallel, sleep 1 turn, contend via LIFO (Rank 7+ chooses); Triangulation is rare & intentional. | `placeDrawnMajorOnBoard()` overflows `Parallel → Event → Center`, causing **87.8% Triangulation wins at avg 8.28 turns** with zero player agency; Courts stick in Left Event and treat Event as `treasure`. | `src/engine/majors.ts` (`placeDrawnMajorOnBoard`, `evaluateCombos`), `src/engine/reconciliation.ts` (`eventCardToReality`), `src/engine/reducer.ts` (`moveResolvedEventToVeil`) | **Critical** | Replace overflow with approved contention/LIFO + Rank-7+ `ChooseMajorExit` + intentional Triangulation path (`RD-06`/`RD-07`). | 500-run Classic sim: Triangulation rate `< 15%`, avg duration `12–25` turns, Eclipse wins & Days exhaustion both occur meaningfully, zero accidental Turn-1 wins. |
| **C3** | **Major Dormancy & Active Court Aura (`RD-06`)** | Newly arrived Major is dormant 1 turn before its active effect/buff applies; active Courts grant `+1/+2/+3` until exit. | `majorPending` emits `MajorActivated` next turn, but dormant Majors trigger `evaluateCombos()` immediately and active Courts never grant board elemental buffs. | `src/engine/majors.ts` (`activateReadyDormantMajors`, `evaluateCombos`), `src/engine/reconciliation.ts` | **High** | Enforce dormancy gate on active Court buffs (and clarify Eclipse eligibility during dormancy in `RD-06`); wire active Court bonuses cleanly into logged reconciliation/elemental math. | Deterministic scenario: Court arrives Turn N (dormant, +0), awakens Turn N+1 (+1/+2/+3 active), leaves on LIFO/Eclipse (+0 again). |
| **C4** | **Earth Reordering Blind Days Cards (`RD-09`)** | Earth must provide *deliberate* control distinct from Air's blind shuffle. | Player view masks Days (`daysCards: null`); UI shows identical face-down backs (`Orig #1, #2, #3`), forcing players to rearrange unknown cards blindly. | `src/engine/visibility.ts` (`projectView`), `src/app/components/GameTable.tsx` (lines 1134–1186), `src/engine/elemental-effects.ts` | **High** | Implement approved `RD-09` Earth peek/commit flow (e.g., private peek of top `strength` Days cards on activation) with strict privacy tests. | Player activates Earth `2 VP` on Days → sees top 2 cards privately, reorders them deliberately, next draw matches chosen order; opponent/log never leaks cards. |
| **C5** | **Reader Bonus Policy & Action UX (`RD-05`)** | Reader bonus rules locked (trigger, element, strength, action-slot cost, expiry) and unmistakable in browser play. | Functional Tier-1 free action (`UseReaderBonus`) implemented and CTA upgraded in `0f13de4`, but ruleset policy (`free_tier1_elemental_next_turn`, `consumesTurnAction`, expiry) remains provisional and untested in real browser E2E. | `src/engine/readings.ts` (`finalizeReadingReward`), `src/engine/elemental-effects.ts` (`validateAndExecuteReaderBonus`), `src/app/components/GameTable.tsx` | **Medium-High** | Lock `RD-05` parameters; add Playwright E2E verifying GOOD → Bot claims Water → Turn 3 gold CTA → Veil selection → Confirm → card resurfaced. | Browser E2E + unit test on `eclipse-me-001` (with approved setup): earn, activate, resolve, and expire paths verified visually and mechanically. |
| **C6** | **Max Hand Size & BAD-Advice Replacement (`RD-02`, `RD-04`)** | Hand limit and `DiscardCenter` flow unambiguously locked. | `maxHandSize = 5`; `DiscardCenter` moves Center to Veil without replacement draw (per Executive Blueprint v0.2), while user playtest comment questioned `3` hand limit and draw-on-BAD. | `src/engine/rulesets.ts`, `src/engine/reducer.ts` (`DiscardCenter`) | **Medium** | Confirm `RD-02` and `RD-04` explicitly; adjust ruleset default only if creator approves. | Explicit scenario verifying hand-limit discard trigger and post-`BAD`-discard phase transition. |
| **C7** | **Trading Market Missing (`RD-10`)** | Scheduled consensual market with offers, gifts, bot negotiation, and immediate post-trade mandatory evolution. | Disabled (`tradingMarket: false`, `marketFrequencyRounds: 0`); `ProposeTrade` / `AcceptTrade` return `FEATURE_DISABLED`. | `src/engine/reducer.ts` (lines 63–64), `src/engine/rulesets.ts` | **High (R3)** | Implement `src/engine/trading.ts`, market phase transitions, fair bot trade evaluator, and compact Market UI drawer in R3. | Scenario: Market opens at end of round → Human offers/gifts card → Bot evaluates/accepts → mandatory evolution chains immediately → invariants hold. |
| **C8** | **Classic Courts vs Sun/Moon Major Labeling** | UI & logs clearly distinguish 12 Classic Court proxies from the 20 future Sun/Moon Major Arcana. | Events and UI badges say `"Major Arcana arrived"` / `"Major +3"` without clarifying Classic Court proxy status. | `src/engine/majors.ts`, `src/app/components/GameTable.tsx`, `src/app/components/DeckView.tsx` | **Medium** | Label Classic mode explicitly as `"Classic Court (Major Proxy)"` across UI, Deck Catalogue, and events; keep Sun/Moon clearly marked as R5 expansion. | Browser E2E assertion + catalogue check verifying accurate proxy labeling. |
| **C9** | **No Automated Browser E2E & Unactivated CI** | Real browser E2E tests catch broken controls/empty hands before handoff; GitHub Actions CI runs on PRs. | Only Vitest unit/sim tests run (53/53); zero Playwright browser tests; CI file parked at `docs/ci-workflow.yml` pending OAuth `workflow` scope. | `package.json`, `docs/ci-workflow.yml` | **High** | Add Playwright E2E suite in R1 covering Turn 1–3 Human vs Bot, Reader Bonus, Earth peek, and Eclipse; activate `.github/workflows/ci.yml` once user refreshes `gh` scope. | `npm run test:e2e` passes headlessly against built app; GitHub Actions green on every PR. |
| **C10** | **UI Monolith (`GameTable.tsx`) & PR Bloat** | Small, single-objective PRs; maintainable modular components. | `GameTable.tsx` is ~1,400 lines (60 KB); PR #1 combines D0 + D1 + D1.1 + D1.2 + D1.3 + E in one >10k-line diff. | `src/app/components/GameTable.tsx`, branch `feature/d1-elemental-gameplay` | **Medium** | Preserve PR #1 as reference baseline; split `GameTable.tsx` into focused subcomponents during R1/R2; enforce one-objective-per-PR going forward. | Clean small PR diffs per recovery stage R1–R5. |
| **C11** | **Turn-1 3-Card Board & Immediate Future Browser (`RD-15`)** | Turn 1 populates all 3 Board slots (`emptyChamberMode = false` default); Deck of Days labels `#1` as `Next Upcoming` and borders `#1–#3` as **Immediate Future**. | `setup.ts` only populates 2 slots (leaving Parallel empty until a Court arrives); `DeckDaysBrowser.tsx` labels `#1` as `Top` with no 3-card Immediate Future border or explicit flow arrow. | `src/engine/setup.ts`, `src/app/components/DeckDaysBrowser.tsx` | **High** | Add `emptyChamberMode` setting (default `false`), implement approved `RD-15` 3-slot flow, and update Deck browser with `Next Upcoming` + bordered **Immediate Future (#1–#3)** framing. | Browser E2E verifies Turn 1 has 3 populated Board slots and Deck browser borders `#1–#3` as Immediate Future with `#1 = Next Upcoming`. |
