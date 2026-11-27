# NEXUS ECLIPSE — RECOVERY & ACCEPTANCE PLAN

**Strategy:** Controlled Gameplay Recovery (Preserve Proven NCE Engine — Freeze Feature Sprawl — Fix in Small Verified Vertical Slices)  
**Reference Branch:** `feature/d1-elemental-gameplay` (PR #1 at `0f13de4`, preserved intact as reference baseline; `origin/main` remains at `f08d169`).

---

## 1. Module Disposition Inventory (Keep / Refactor / Replace)

| Module / Area | Classification | Rationale |
|---|---|---|
| `src/engine/rng.ts`, `hash.ts`, `invariants.ts`, `cards.ts`, `evolution.ts`, `event-helpers.ts`, `formatters.ts` | **Keep unchanged** | Proven pure deterministic core; 0 invariant or replay failures across 1,500+ seeded runs. |
| `src/engine/readings.ts`, `reconciliation.ts` | **Keep & tune via ruleset** | Cleanly decouples advice/action/outcome/reward and Left-Event thresholds; only needs rule lock (`RD-05`, `RD-08`, `RD-12`). |
| `src/engine/setup.ts`, `visibility.ts`, `elemental-effects.ts`, `reducer.ts`, `rulesets.ts` | **Targeted refactor** | Keep structure and command/event pipeline; apply surgical fixes for `RD-01` (3-card opening hand), `RD-09` (Earth private peek), `RD-05` (Reader bonus policy), and `RD-06`/`RD-07` hooks. |
| `src/engine/majors.ts` | **Replace cleanly (R2)** | Current `Parallel → Event → Center` auto-overflow causes 87.8% accidental Triangulation wins and cosmetic dormancy. Rewrite around approved contention/LIFO/Rank-7+ and intentional Triangulation. |
| `src/engine/trading.ts` *(new)* | **Add in R3** | Clean isolated module for scheduled consensual Market, offers/gifts, and post-trade mandatory evolution. |
| `src/sim/botController.ts`, `agents.ts`, `runner.ts`, `cli.ts` | **Keep & extend telemetry** | Fair masked-view enforcement is solid; extend `runner.ts` metrics to report Triangulation %, Eclipse %, avg turns, Reader bonus usage, Earth usage, and Trading activity. |
| `src/app/elementalTargeting.ts`, `storage.ts`, `CardBack.tsx`, `CardTile.tsx`, `DeckDaysBrowser.tsx`, `VeilBrowser.tsx`, `DeckView.tsx`, `RulesView.tsx`, `SimulationLabView.tsx`, `InspectorDrawer.tsx` | **Keep & refine** | Clean modular components and verified targeting helpers. |
| `src/app/components/GameTable.tsx` (60 KB / ~1,400 lines) | **Refactor incrementally** | Split into focused subcomponents (`PlayerIdentityStrip`, `SharedBoardZone`, `ActionStagePanel`, `PlayerHandPanel`) during R1/R2 — no wholesale rewrite. |
| `tests/*.test.ts` (53 passing tests) | **Keep + add Playwright E2E** | Retain every historical Milestone A–D1 regression test; add real browser E2E suite starting in R1. |

---

## 2. Recovery Stages & Small Acceptance Gates

**Rule:** One coherent gameplay objective per pull request. No stage begins until its prerequisite Rule Decisions in [`docs/RULE_DECISIONS.md`](./RULE_DECISIONS.md) are approved by the creator.

### Stage R0 — Gameplay Contract & Audit *(Current — Zero Code Changes)*
- **Deliverables:** `docs/GAMEPLAY_CONTRACT.md`, `docs/RULE_DECISIONS.md`, `docs/ACCEPTANCE_PLAN.md`.
- **Exit Gate:** Creator reviews compliance matrix and signs off on `RD-01` through `RD-05` & `RD-09` (unlocking R1).

### Stage R1 — First-Turn Reliability, Immediate Future UX, Reader Bonus & Browser E2E
- **Scope:**
  - Fix starting-hand setup invariant (`RD-01`) and hand limit (`RD-02`) so every new game begins with 3 playable cards.
  - Implement Turn-1 3-card Board population + optional `emptyChamberMode` ruleset toggle (`RD-15`).
  - Upgrade Deck of Days browser with explicit left-to-right flow, `#1` labeled **`Next Upcoming`**, and bordered **`Immediate Future (Next 3 Cards)`** (`#1–#3`).
  - Lock `DiscardCenter` flow (`RD-04`) and flexible Reader Bonus timing with explicit element-specific Tier-1 action descriptions (`RD-05`).
  - Fix Earth Deck-of-Days private temporary peek & deliberate reorder (`RD-09`).
  - Split `GameTable.tsx` into modular subcomponents for maintainability.
  - Add **Playwright browser E2E suite** (`npm run test:e2e`) running against the real built Vite app.
- **Acceptance Gate (All Required):**
  1. `eclipse-me-001` and 500 seeded starts guarantee 3 playable hand cards at Turn 1 start (`0` invariant/replay failures).
  2. Browser E2E walks Turns 1–3 in Human vs Bot: Turn 1 starts with 3 hand cards → Elemental Prep → Bot advises GOOD/BAD → Pursue/Discard → Event reconciliation → Human gives GOOD reading for Bot → Turn 3 gold Reader Bonus activates, targets Veil/Zone, and resolves visibly.
  3. Browser E2E verifies Earth activation privately shows top `strength` Days cards to active player, reorders them, and next draw matches chosen card without leaking to opponent view.
  4. `typecheck`, Vitest, Playwright E2E, and `vite build` all pass.

### Stage R2 — Classic Courts Lifecycle, Eclipse & Intentional Triangulation
- **Prerequisite:** Creator approval of `RD-06`, `RD-07`, `RD-08`.
- **Scope:**
  - Replace `src/engine/majors.ts` with approved Parallel arrival, real 1-turn dormancy, active Court buffs (`J +1 / Q +2 / K +3`), LIFO contention + Rank 7–9 `ChooseMajorExit`, Eclipse formation, and intentional Triangulation path.
  - Update UI/logs to label Classic proxies explicitly (`Classic Court · Major Proxy`) vs future Sun/Moon Major Arcana.
- **Acceptance Gate (All Required):**
  1. Deterministic unit tests for dormancy (inactive Turn N → active Turn N+1), LIFO contention (Rank 1–6), Rank 7+ `ChooseMajorExit`, Classic Eclipse (opposite-color same rank), and intentional Triangulation.
  2. 500-run Classic simulation telemetry meets healthy sanity bounds:
     - **0** invariant or replay failures.
     - **0** accidental Turn-1 victories.
     - Triangulation victory rate **< 15%** (no mass accidental Triangulation).
     - Eclipse victories and Days exhaustion both occur meaningfully.
     - Average game duration **12–25 turns** (not 8 turns).
  3. Browser E2E covers a scripted Court arrival, contention choice, and Eclipse formation.

### Stage R3 — Consensual Trading Market & Bot Negotiation
- **Prerequisite:** Creator approval of `RD-10`, `RD-11`.
- **Scope:**
  - Implement `src/engine/trading.ts` (`ProposeTrade`, `AcceptTrade`, `RejectTrade`, `CloseMarket`), scheduled round-boundary Market phase, immediate post-trade mandatory chained evolution, fair masked-view Bot trade negotiator, and compact tabletop Market modal.
- **Acceptance Gate (All Required):**
  1. Deterministic tests for 1-for-1 trade, uneven trade, 1-way gift, rejection, immediate post-trade evolution chain, and card conservation.
  2. Browser E2E completes a Market phase (Human proposes → Bot accepts/rejects → evolution fires → returns to play).
  3. 500-run Classic simulation reports non-zero trading activity with `0` invariant/replay failures.

### Stage R4 — Full Classic Prototype Validation, Balance Report & CI Lock
- **Scope:**
  - Full 1,000-run Classic balance report (outcome distribution, turn duration, evolution depth, Eclipse/Triangulation rates, elemental usage by suit, Reader bluff/bonus rates, Market trades, element win-rate parity).
  - Activate `.github/workflows/ci.yml` (requires creator running `gh auth refresh -s workflow` once) enforcing `typecheck` + `test` + `test:e2e` + `sim` + `build` on every PR.
  - Human playtest sign-off across 3+ full seeded games; merge verified Classic Prototype to `main`.

### Stage R5 — Bespoke Sun/Moon Major Arcana Expansion
- **Prerequisite:** R4 merged + creator approval of `RD-13`, `RD-14`, and per-Major acceptance scenarios.
- **Scope:** Data-driven Arcana Registry implementing one approved subset at a time (Champions → Visibility/Access Majors `Reflection`/`Sun Lighthouse`/`Garden Gates`/`Hidden Garden` → Relational `Connection`/`Pangaea` → Restoration/Destruction `Split Moon Tower`/`Tree of Life`/`Death-Rebirth` → Time Cycle `Shekhinah`/`Moon`/`Sun`). Unresolved Majors (`Rising/Falling Star`, `Merkabah`, `Dual Harmony Creator`) remain disabled until individually specified.

---

## 3. Mandatory Simulation Telemetry Metrics

Every release gate simulation run (`src/sim/runner.ts`) must output:
- Outcome distribution (`eclipse_victory`, `triangulation_victory`, `days_exhausted`, `target_rank_reached`)
- Average & median turn duration (and min turn count to catch Turn-1 accidents)
- Evolution distribution (% reaching Rank 4+, Rank 7+, Rank 9; avg chains)
- Eclipse count per game & per winning player
- Triangulation frequency & trigger source
- Elemental activation counts by suit (`Air`, `Fire`, `Water`, `Earth`) & Reader Bonus earn/consume/expire counts
- Trading proposals, acceptances, gifts, and trade-triggered evolutions
- Hard integrity count: `invariantFailures === 0`, `replayFailures === 0`, `privacyLeakFailures === 0`

---

## 4. CI Activation Checklist

1. Ready-to-run workflow currently lives at [`docs/ci-workflow.yml`](./ci-workflow.yml) (blocked from `.github/workflows/ci.yml` only because the local `gh` token lacks `workflow` scope).
2. Creator runs once: `gh auth refresh -s workflow`.
3. Move `docs/ci-workflow.yml` → `.github/workflows/ci.yml` and add the Playwright E2E job in R1.
