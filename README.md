# Nexus Central Engine (NCE) — Nexus Eclipse Classic MVP (`v0.7.0-classic-mvp`)

Local-first deterministic TypeScript rules engine, headless multi-policy CLI simulation lab, and modular card-game Play Table for the **48-Card Classic Nexus Eclipse MVP** (36 Minor cards Ace–9 + 12 Classic Court Major Arcana proxies across Air, Fire, Water, Earth).

## Architecture

- **`src/engine/`** — Pure deterministic rules engine (zero UI, network, filesystem, or database dependencies):
  - Core: `types.ts`, `cards.ts`, `rng.ts`, `hash.ts`, `invariants.ts`, `rulesets.ts`, `setup.ts`, `evolution.ts`, `readings.ts`, `event-helpers.ts`, `reducer.ts`
  - **Classic MVP Systems:**
    - `majors.ts` — Explicit Major Arcana Court lifecycle: dedicated `Parallel` chamber (no overflow), 1-turn dormancy gating active Court aura buffs (`+1/+2/+3`), Eclipse checked FIRST on arrival/contention with persistent `EclipseTrophy` records, true LIFO default departure, and Rank 7–9 `AWAITING_MAJOR_CONTENTION` (`ChooseMajorExit`).
    - `reconciliation.ts` — `RD-08` VP arithmetic separating `cappedBaseVP (max 3)` from `activeCourtAuraVP` and cumulative `persistentEclipseBonusVP`; `Event` Courts explicitly typed `major_resonance` (`R2-BUG-01` fixed).
    - `elemental-effects.ts` — Atomic hand-card activations (`Air`, `Fire`, `Water`, `Earth`), Board-first Pre-Reading Prep + Revealed-Board Intervention sharing 1 ordinary action/turn, separate anytime free Tier-1 Reader Bonuses, and cheat-proof private Earth peek & reorder (`board` / `days` / `board_and_days`) with `R2-Center-Court-Guard`.
    - `trading.ts` — Scheduled round-boundary Consensual Trading Market (`AWAITING_MARKET` every 2 rounds): 1-for-1, multi-card uneven trades, 1-way gifts, privacy-safe counter-card selection, and immediate post-trade mandatory chained evolution.
    - `actions.ts` & `visibility.ts` — Engine-derived `LegalActionDescriptor[]` (single source of truth for UI affordances, disabled reasons, Tier-1 limits, and End-Turn bonus expiry warnings) + strict player-safe visibility projections.
- **`src/sim/`** — Headless deterministic batch simulator (`agents.ts`, `runner.ts`, `formatters.ts`, `cli.ts`) and strict player-safe Fair Bot AI (`botController.ts`) supporting Readings, Elemental actions, AB-1 abandonment evaluation, Rank 7–9 Major Contention, and consensual Trading negotiation.
- **`src/app/`** — Local Vite + React card-game table re-scaffolded into modular components:
  - `src/app/table/` — `PlayTable.tsx`, `PlayerIdentityBar.tsx`, `SharedBoard.tsx`, `ImmediateFutureTray.tsx` (interactive `#1–#3` targeting), `ActionDock.tsx` (intent-driven with End-Turn Reader Bonus expiry guard), `EventPlaybackOverlay.tsx` (Eclipse Resolution spotlight), `MajorContentionModal.tsx`, `MarketDrawer.tsx`.
  - Supporting views: `DeckView.tsx`, `RulesView.tsx`, `SimulationLabView.tsx`, `InspectorDrawer.tsx`, `SavedGamesPanel.tsx`, and IndexedDB multi-session persistence (`storage.ts`).
- **`tests/`** — Deterministic unit, invariant, privacy, scenario, full-game, and Playwright browser E2E suites:
  - `tests/classic-mvp-rescaffold.test.ts` (Scenarios 1–9: Court lifecycle, LIFO, Turn-1 Eclipse, Rank 7–9 Contention, Deliberate Triangulation, `RD-08` VP math, Turn 2→3→4 Earth Bonus fixture, Trading Market + evolution, Quick Eclipse)
  - `tests/stage-r1-recovery.test.ts` (R1 + R1.1 Revealed-Board Intervention, AB-1 Abandonment, Earth `board_and_days`, experimental chaining, 500-run gate)
  - `tests/milestone-e-majors.test.ts`, `tests/milestone-d1.test.ts`, `tests/milestone-c-scenarios.test.ts`, `tests/engine.test.ts`, `tests/human-vs-bot.test.ts`, `tests/elemental-ui-targeting.test.ts`, `tests/deck-veil-browser.test.ts`
  - `tests/e2e/classic-mvp.spec.ts` & `tests/e2e/r1-acceptance.spec.ts` (Playwright real-browser acceptance walkthroughs)

## Turn Contract (`poker-proto-e v2.0.0`)

1. **Board Populated** (all 3 slots: `Event`, `Center`, `Parallel`)
2. **Optional Elemental Prep** (before Reading)
3. **Private Reading & Decision** (`Pursue` or `Reject & Replace`)
4. **Board Reveal** (`Center + Event` face-up)
5. **Optional Revealed-Board Elemental Intervention** *(if your 1 ordinary action wasn't spent in Step 2)*
6. **Reconciliation** (`Treasure` / `Major Resonance` / `Barrier` / `Trial` + mandatory chained evolution)
7. **End Turn** *(with explicit Reader Bonus expiry warning if unused; scheduled Trading Market every 2 rounds)*

## Quick Commands

```bash
npm install
npm run typecheck
npm test
npm run sim -- --runs 1000 --preset poker-proto-e --policy bluffing-rival
npm run build
npm run test:e2e
npm run dev
```

## Deferred Scope (Future Expansion)

- **Sun/Moon Bespoke Expansion (Stage R5):** 20 bespoke Sun/Moon Major Arcana (`Sun 0`–`9`, `Moon 0`–`9`), Moon Entropy / Sun Renewal cycle, and `Reflection` / `Garden Gates` / `Connection` / `Pangaea` effects remain cleanly feature-flagged inactive until Classic MVP playtesting is signed off.
