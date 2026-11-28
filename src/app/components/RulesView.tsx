import {
  RULE_ANNOTATIONS,
  type ElementalActionsPerTurnPolicy,
  type ElementalTimingPolicy,
  type EvolutionColorPolicy,
  type EvolutionTieBreakPolicy,
  type GameState,
  type InvariantReport,
  type ReaderBonusPolicy,
  type Ruleset,
  type WaterResurfaceDestination
} from '../../engine/index.js';

export interface RulesDraftState {
  colors: EvolutionColorPolicy;
  jump: number;
  tieBreak: EvolutionTieBreakPolicy;
  startHand: number;
  maxHand: number;
  preventSetupEvolution: boolean;
  replaceCenterOnDiscard: boolean;
  emptyChamberMode: boolean;
  readerBonusAnytimeOnTurn: boolean;
  readerBonusOnAbandon: boolean;
  readerBonusPolicy: ReaderBonusPolicy;
  readerBonusConsumesTurnAction: boolean;
  rotateEventOnCenterDiscard: boolean;
  elementalTiming: ElementalTimingPolicy;
  maxElementalActionsPerTurn: ElementalActionsPerTurnPolicy;
  waterResurfaceDestination: WaterResurfaceDestination;
  elementalNativePrimaryBonusVP: number;
  trialTarget: 'event' | 'center';
  trialBonusVP: number;
  hintsEnabled: boolean;
}

export function RulesView({
  ruleset,
  draft,
  inspectedState,
  invariantReport,
  onChangeDraft,
  onApply
}: {
  ruleset: Ruleset;
  draft: RulesDraftState;
  inspectedState: GameState;
  invariantReport: InvariantReport;
  onChangeDraft: (patch: Partial<RulesDraftState>) => void;
  onApply: () => void;
}) {
  return (
    <div className="stage-with-drawer">
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Milestone D1 Configurable Ruleset Parameters</h2>
          <span className="badge">v{ruleset.version}</span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label>Evolution Color Policy</label>
            <select
              className="select"
              value={draft.colors}
              onChange={(e) => onChangeDraft({ colors: e.target.value as EvolutionColorPolicy })}
            >
              <option value="same-color">Same Color (Basic)</option>
              <option value="same-element">Same Element (Hard)</option>
              <option value="any">Any Color (Experimental)</option>
            </select>
          </div>

          <div className="field">
            <label>Max Evolution Jump</label>
            <select
              className="select"
              value={draft.jump}
              onChange={(e) => onChangeDraft({ jump: Number(e.target.value) })}
            >
              <option value={1}>+1 only (Hard)</option>
              <option value={2}>+1 or +2 (Basic)</option>
            </select>
          </div>

          <div className="field">
            <label>Evolution Tie-Breaker (Provisional)</label>
            <select
              className="select"
              value={draft.tieBreak}
              onChange={(e) => onChangeDraft({ tieBreak: e.target.value as EvolutionTieBreakPolicy })}
            >
              <option value="lowest-rank-same-element">Lowest Rank → Same Element</option>
              <option value="lowest-rank-first">Lowest Rank → Card ID</option>
              <option value="highest-jump-first">Highest Jump First</option>
            </select>
          </div>

          <div className="field">
            <label>Turn-1 3-Card Opening Hand (RD-01)</label>
            <select
              className="select"
              value={draft.preventSetupEvolution ? 'yes' : 'no'}
              onChange={(e) => onChangeDraft({ preventSetupEvolution: e.target.value === 'yes' })}
            >
              <option value="yes">Guaranteed 3 Playable Cards (R1 Default)</option>
              <option value="no">Allow Setup Auto-Evolution (Legacy)</option>
            </select>
          </div>

          <div className="field">
            <label>Reject Reading Card Behavior (RD-04 AGREED)</label>
            <select
              className="select"
              value={draft.replaceCenterOnDiscard ? 'replace' : 'end'}
              onChange={(e) =>
                onChangeDraft({ replaceCenterOnDiscard: e.target.value === 'replace' })
              }
            >
              <option value="replace">Send to Veil + Draw &amp; Flip New Card + Event (R1 Default)</option>
              <option value="end">Send to Veil &amp; End Encounter (Legacy MC/D1)</option>
            </select>
          </div>

          <div className="field">
            <label>Right Chamber Setup (RD-15)</label>
            <select
              className="select"
              value={draft.emptyChamberMode ? 'empty' : 'filled'}
              onChange={(e) => onChangeDraft({ emptyChamberMode: e.target.value === 'empty' })}
            >
              <option value="filled">Populate All 3 Board Slots on Turn 1 (Default)</option>
              <option value="empty">Empty Chamber Mode (Vacant Until Major)</option>
            </select>
          </div>

          <div className="field">
            <label>Reader Bonus Activation Window (RD-05)</label>
            <select
              className="select"
              value={draft.readerBonusAnytimeOnTurn ? 'anytime' : 'window'}
              onChange={(e) =>
                onChangeDraft({ readerBonusAnytimeOnTurn: e.target.value === 'anytime' })
              }
            >
              <option value="anytime">Anytime During Your Turn (R1 Default)</option>
              <option value="window">Elemental Window Only (Legacy D1)</option>
            </select>
          </div>

          <div className="field">
            <label>Reader Bonus Spending Policy (Provisional)</label>
            <select
              className="select"
              value={draft.readerBonusPolicy}
              onChange={(e) =>
                onChangeDraft({ readerBonusPolicy: e.target.value as ReaderBonusPolicy })
              }
            >
              <option value="free_tier1_elemental_next_turn">
                Free Tier-1 Elemental Next Turn (D1 Default)
              </option>
              <option value="record_only">Record Only (Milestone C Baseline)</option>
            </select>
          </div>

          <div className="field">
            <label>Reader Bonus Action Budget (Provisional)</label>
            <select
              className="select"
              value={draft.readerBonusConsumesTurnAction ? 'shared' : 'extra'}
              onChange={(e) =>
                onChangeDraft({ readerBonusConsumesTurnAction: e.target.value === 'shared' })
              }
            >
              <option value="shared">Counts toward 1 Action/Turn (Default)</option>
              <option value="extra">Extra Bonus Action (Experiment)</option>
            </select>
          </div>

          <div className="field">
            <label>Water Resurface Destination (Provisional)</label>
            <select
              className="select"
              value={draft.waterResurfaceDestination}
              onChange={(e) =>
                onChangeDraft({
                  waterResurfaceDestination: e.target.value as WaterResurfaceDestination
                })
              }
            >
              <option value="shuffled">Shuffled into Deck of Days (Default)</option>
              <option value="top">Top of Deck of Days</option>
              <option value="bottom">Bottom of Deck of Days</option>
            </select>
          </div>

          <div className="field">
            <label>Elemental Action Timing</label>
            <select
              className="select"
              value={draft.elementalTiming}
              onChange={(e) =>
                onChangeDraft({ elementalTiming: e.target.value as ElementalTimingPolicy })
              }
            >
              <option value="before_reading">Before Reading (Board Set → Elemental Prep)</option>
              <option value="after_encounter">After Encounter (Milestone D1 Baseline)</option>
            </select>
          </div>

          <div className="field">
            <label>Elemental Actions Per Turn (Chaining On Hold)</label>
            <select
              className="select"
              value={String(draft.maxElementalActionsPerTurn)}
              onChange={(e) => {
                const raw = e.target.value;
                onChangeDraft({
                  maxElementalActionsPerTurn:
                    raw === 'unlimited' ? 'unlimited' : (Number(raw) as 1 | 2 | 3)
                });
              }}
            >
              <option value="1">1 per turn (Standard Default — Chaining On Hold)</option>
              <option value="2">2 per turn (Experimental Chain)</option>
              <option value="3">3 per turn (Experimental Chain)</option>
              <option value="unlimited">Unlimited (Experimental Massive Swings)</option>
            </select>
          </div>

          <div className="field">
            <label>Left Event on DiscardCenter (Provisional)</label>
            <select
              className="select"
              value={draft.rotateEventOnCenterDiscard ? 'rotate' : 'keep'}
              onChange={(e) =>
                onChangeDraft({ rotateEventOnCenterDiscard: e.target.value === 'rotate' })
              }
            >
              <option value="rotate">Rotate Unused Event → Veil (D1 Default)</option>
              <option value="keep">Keep Concealed Event on Board (MC Baseline)</option>
            </select>
          </div>

          <div className="field">
            <label>Native Primary Element Bonus VP (Provisional)</label>
            <select
              className="select"
              value={draft.elementalNativePrimaryBonusVP}
              onChange={(e) =>
                onChangeDraft({ elementalNativePrimaryBonusVP: Number(e.target.value) })
              }
            >
              <option value={0}>0 (Exact Card VP 1/2/3 — Default)</option>
              <option value={1}>+1 VP Native Amplification (Capped at 3)</option>
            </select>
          </div>

          <div className="field">
            <label>GOOD → Pursue → Abandon Reader Bonus</label>
            <select
              className="select"
              value={draft.readerBonusOnAbandon ? 'yes' : 'no'}
              onChange={(e) => onChangeDraft({ readerBonusOnAbandon: e.target.value === 'yes' })}
            >
              <option value="no">No — Requires Claim (Creator Ruling)</option>
              <option value="yes">Yes — Award on Pursue (Test Toggle)</option>
            </select>
          </div>

          <div className="field">
            <label>Trial Elemental Target (Provisional)</label>
            <select
              className="select"
              value={draft.trialTarget}
              onChange={(e) => onChangeDraft({ trialTarget: e.target.value as 'event' | 'center' })}
            >
              <option value="event">Left Event Element (Default)</option>
              <option value="center">Center Card Element (Experiment)</option>
            </select>
          </div>

          <div className="field">
            <label>Trial Advantage Bonus VP (Provisional)</label>
            <select
              className="select"
              value={draft.trialBonusVP}
              onChange={(e) => onChangeDraft({ trialBonusVP: Number(e.target.value) })}
            >
              <option value={1}>+1 VP once (Default)</option>
              <option value={0}>0 VP (Gate only — must sacrifice)</option>
            </select>
          </div>

          <div className="field">
            <label>Optional Lineage Reading Hints</label>
            <select
              className="select"
              value={draft.hintsEnabled ? 'on' : 'off'}
              onChange={(e) => onChangeDraft({ hintsEnabled: e.target.value === 'on' })}
            >
              <option value="off">Off (Canonical v0.2)</option>
              <option value="on">On (Experimental Color/Tier hints)</option>
            </select>
          </div>

          <div className="field">
            <label>Starting Hand / Max Hand</label>
            <div className="toolbar-group">
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={0}
                max={5}
                value={draft.startHand}
                onChange={(e) => onChangeDraft({ startHand: Number(e.target.value) })}
              />
              <span>/</span>
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={2}
                max={8}
                value={draft.maxHand}
                onChange={(e) => onChangeDraft({ maxHand: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="toolbar-group">
          <button className="btn btn-primary" onClick={onApply}>
            Apply Custom Rules &amp; Start Seeded Game
          </button>
        </div>

        <div className="panel-header" style={{ marginTop: 8 }}>
          <h2 className="panel-title">Rules Confidence Registry (Agreed · Provisional · Open)</h2>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Status</th>
              <th>Specification</th>
            </tr>
          </thead>
          <tbody>
            {RULE_ANNOTATIONS.map((a) => (
              <tr key={a.key}>
                <td>
                  <strong>{a.label}</strong>
                </td>
                <td>
                  <span
                    className={`badge ${
                      a.status === 'agreed'
                        ? 'badge-ok'
                        : a.status === 'provisional'
                          ? 'badge-warn'
                          : ''
                    }`}
                  >
                    {a.status.toUpperCase()}
                  </span>
                </td>
                <td>{a.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <aside className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Feature Flags (Milestone Gate)</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Flag</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ruleset.features)
              .filter(([k]) => k !== 'majorEffects')
              .map(([flag, enabled]) => (
                <tr key={flag}>
                  <td className="mono">{flag}</td>
                  <td>
                    <span className={`badge ${enabled ? 'badge-ok' : ''}`}>
                      {enabled ? 'ACTIVE' : 'DEFERRED'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="panel-header" style={{ marginTop: 8 }}>
          <h2 className="panel-title">State Hash &amp; Diagnostics</h2>
        </div>
        <div className="mono">
          engine: {inspectedState.engineVersion}
          <br />
          stateHash: {inspectedState.stateHash}
          <br />
          canonicalCards: {inspectedState.deckCardIds.length}
          <br />
          commands: {inspectedState.commandHistory.length} accepted /{' '}
          {inspectedState.rejectedCommands.length} rejected
          <br />
          invariantsOk: {String(invariantReport.ok)}
        </div>
      </aside>
    </div>
  );
}
