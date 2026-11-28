import {
  ELEMENT_META,
  type Command,
  type ProjectedMajorContentionView
} from '../../engine/index.js';

export function MajorContentionModal({
  contention,
  canAct,
  onSendCommand
}: {
  contention: ProjectedMajorContentionView;
  canAct: boolean;
  onSendCommand: (cmd: Command) => void;
}) {
  const { incumbentCard, arrivingCard, incumbentDormant, playerId } = contention;
  const incEl = incumbentCard.element ? ELEMENT_META[incumbentCard.element].label : '';
  const arrEl = arrivingCard.element ? ELEMENT_META[arrivingCard.element].label : '';

  return (
    <div className="contention-panel" data-testid="major-contention-panel">
      <div className="action-row">
        <div>
          <h2 className="decision-title">
            ✦ Rank 7–9 Major Contention — Choose Which Court Exits Parallel Dimension
          </h2>
          <div className="brand-sub">
            {arrivingCard.label} ({arrivingCard.shortLabel}) arrived while {incumbentCard.label} (
            {incumbentCard.shortLabel}) holds Parallel. Your high lineage rank lets you override
            default LIFO departure.
          </div>
        </div>
      </div>

      <div className="contention-choices-grid">
        <div className="contention-choice-card">
          <div className="badge">{incumbentDormant ? 'Resident (Dormant)' : 'Resident (Active)'}</div>
          <div
            className={`eclipse-court-tile ${
              incumbentCard.color === 'red' ? 'color-red' : 'color-black'
            }`}
          >
            <div className="eclipse-court-short">{incumbentCard.shortLabel}</div>
            <div className="eclipse-court-name">{incumbentCard.label}</div>
          </div>
          <div className="brand-sub">
            +{incumbentCard.courtBonus ?? 1} {incEl} aura while active
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="contention-keep-incumbent-btn"
            disabled={!canAct}
            onClick={() =>
              onSendCommand({
                type: 'ChooseMajorExit',
                playerId,
                cardId: arrivingCard.id
              })
            }
          >
            Keep {incumbentCard.shortLabel} · Send {arrivingCard.shortLabel} to Veil
          </button>
        </div>

        <div className="contention-choice-card">
          <div className="badge badge-warn">Arriving Court</div>
          <div
            className={`eclipse-court-tile ${
              arrivingCard.color === 'red' ? 'color-red' : 'color-black'
            }`}
          >
            <div className="eclipse-court-short">{arrivingCard.shortLabel}</div>
            <div className="eclipse-court-name">{arrivingCard.label}</div>
          </div>
          <div className="brand-sub">
            +{arrivingCard.courtBonus ?? 1} {arrEl} aura (dormant 1 turn on arrival)
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="contention-keep-arriving-btn"
            disabled={!canAct}
            onClick={() =>
              onSendCommand({
                type: 'ChooseMajorExit',
                playerId,
                cardId: incumbentCard.id
              })
            }
          >
            Welcome {arrivingCard.shortLabel} · Send {incumbentCard.shortLabel} to Veil
          </button>
        </div>
      </div>
    </div>
  );
}
