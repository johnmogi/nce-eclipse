# Nexus Central Engine (NCE) — Nexus Eclipse (`v0.4.0-md1`)

Local-first deterministic TypeScript rules engine, headless CLI simulation lab, and playable Dev Console for **Nexus Eclipse** (Milestones **A + B + C + D0 + D1**).

## Architecture

- **`src/engine/`** — Pure deterministic rules engine (zero UI, network, filesystem, or database dependencies):
  - `types.ts`, `cards.ts`, `rng.ts`, `hash.ts`, `invariants.ts`, `rulesets.ts`
  - `setup.ts`, `evolution.ts`, `readings.ts`, `reconciliation.ts`, `elemental-effects.ts`, `event-helpers.ts`, `reducer.ts`
  - `visibility.ts`, `formatters.ts` — strict player-safe projections (deterministic `seed`, concealed Center/Event cards, opponent hands, and Days order masked from unauthorized players)
- **`src/sim/`** — Headless deterministic batch simulator (`agents.ts`, `runner.ts`, `formatters.ts`, `cli.ts`) and role-masked fair Bot controller (`botController.ts`)
- **`src/app/`** — Local Vite + React Dev Console defaulting to **Human (Player 1) vs Autonomous Bot (Player 2)** with permanent Primary Ace + evolving Lineage cards, persistent 4-step turn progress (`Reading → Encounter → Elemental Action → End Turn`), unified 3-zone tabletop layout (`components/GameTable.tsx`, `components/CardBack.tsx`, `elementalTargeting.ts`, `components/InspectorDrawer.tsx`, `components/DeckView.tsx`, `components/RulesView.tsx`, `components/SimulationLabView.tsx`), and IndexedDB persistence
- **`tests/`** — Deterministic unit, invariant, privacy, scenario, UI targeting, Human-vs-Bot fairness, and batch regression suites:
  - `tests/engine.test.ts` (Milestones A + B + L1.2)
  - `tests/milestone-c-scenarios.test.ts` (Executive Blueprint v0.2 scenarios `S1–S6` preserved baseline)
  - `tests/milestone-d1.test.ts` (D0 privacy/rotation fixes, D1 Elemental Activation Cost, Water self-resurface regression, Reader Bonus spending/expiry, and 500-run D1 gate)
  - `tests/elemental-ui-targeting.test.ts` (D1.1 direct card-to-zone targeting & Water resurface acceptance walkthrough)
  - `tests/human-vs-bot.test.ts` (D1.2 autonomous Bot opening reading, permanent Primary Aces, fair role-masked AI, and multi-round replay)

## Implemented Rules Scope (Milestones A–D1)

- **Agreed Rules Implemented:**
  - Mandatory chained personal evolution (`same-color +1/+2` Basic, `same-element +1` Hard)
  - Concealed Readings (`GOOD`/`BAD`) decoupled from player action (`PURSUE`/`DISCARD`), outcome, and Reader reward
  - Left Event Realities (`7–9` Treasure, `4–6` Barrier `>= 2 VP`, `1–3` Trial `> 1 VP` + elemental leverage)
  - **D1 Elemental Activation Cost:** Activating Air (`♠` Shuffle), Fire (`♣` Burn), Water (`♥` Resurface), or Earth (`♦` Reorder) consumes the selected hand card into the Veil atomically at its original VP (`1–3`, no silent `VP+1` scaling) and counts toward the 1-action-per-turn limit
  - **D1 Water Self-Resurface Prohibition:** An activating Water card enters the Veil and is strictly ineligible for resurfacing during that same action (recoverable on a subsequent separate action)
- **Provisional Configurable Knobs (Versioned in `Ruleset`):**
  - `readerBonusPolicy`: `free_tier1_elemental_next_turn` (D1 default, separate from hand-card activations, expires if unused on Reader's next turn) vs. `record_only` (Milestone C baseline)
  - `waterResurfaceDestination`: `shuffled` (default) | `top` | `bottom`
  - `rotateEventOnCenterDiscard`: `true` (D1 default) | `false` (Milestone C baseline)
  - `elementalNativePrimaryBonusVP`: `0` (default exact card VP) | `1`
- **Deferred (Feature-Flagged Inactive):** Trading Market (`D2`), Classic Courts / Eclipse / Triangulation (`E`), 20 Sun/Moon Major Arcana & Entropy Cycle (`F`).

## Quick Commands

```bash
npm install
npm run typecheck
npm test
npm run sim -- --runs 500 --preset poker-proto-d1 --policy bluffing-rival
npm run sim -- --runs 500 --preset poker-proto-c --policy bluffing-rival
npm run build
npm run dev
```
