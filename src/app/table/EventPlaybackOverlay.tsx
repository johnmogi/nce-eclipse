import type { Card, GameEvent, ProjectedGameView } from '../../engine/index.js';

export interface EclipsePresentationItem {
  readonly eventSeq: number;
  readonly actorName: string;
  readonly residentCard: Card | null;
  readonly arrivingCard: Card | null;
  readonly bonusVP: number;
  readonly eclipseCount: number;
  readonly requiredEclipses: number;
  readonly disposition: string;
  readonly summary: string;
}

export function extractEclipsePresentation(
  event: GameEvent,
  view: ProjectedGameView
): EclipsePresentationItem | null {
  if (event.type !== 'EclipseFormed') return null;
  const payload = event.payload ?? {};
  const residentId = typeof payload.residentCardId === 'string' ? payload.residentCardId : event.affectedCardIds[0];
  const arrivingId = typeof payload.arrivingCardId === 'string' ? payload.arrivingCardId : event.affectedCardIds[1];

  const findCard = (id: string | undefined): Card | null => {
    if (!id) return null;
    const fromCatalog = view.deckComponents.find((dc) => dc.card.id === id)?.card;
    if (fromCatalog) return fromCatalog;
    return view.veil.find((c) => c.id === id) ?? null;
  };

  const actor = view.players.find((p) => p.id === event.actor);
  return {
    eventSeq: event.seq,
    actorName: actor?.name ?? event.actor,
    residentCard: findCard(residentId),
    arrivingCard: findCard(arrivingId),
    bonusVP: typeof payload.courtBonusVP === 'number' ? payload.courtBonusVP : 1,
    eclipseCount: typeof payload.eclipseCount === 'number' ? payload.eclipseCount : 1,
    requiredEclipses: typeof payload.requiredEclipses === 'number' ? payload.requiredEclipses : 3,
    disposition: typeof payload.disposition === 'string' ? payload.disposition : 'both_to_veil',
    summary: event.summary
  };
}

export function EventPlaybackOverlay({
  eclipse,
  onAcknowledge
}: {
  eclipse: EclipsePresentationItem | null;
  onAcknowledge: () => void;
}) {
  if (!eclipse) return null;

  return (
    <div
      className="eclipse-spotlight-backdrop"
      role="dialog"
      aria-label="Eclipse Resolution"
      data-testid="eclipse-resolution-overlay"
    >
      <div className="eclipse-spotlight-card">
        <div className="eclipse-spotlight-eyebrow">ECLIPSE RESOLUTION</div>

        <div className="eclipse-cards-pair">
          <div className="eclipse-court-column">
            <div
              className={`eclipse-court-tile ${
                eclipse.residentCard?.color === 'red' ? 'color-red' : 'color-black'
              }`}
            >
              <div className="eclipse-court-short">
                {eclipse.residentCard?.shortLabel ?? 'Major'}
              </div>
              <div className="eclipse-court-name">
                {eclipse.residentCard?.label ?? 'Resident Court'}
              </div>
            </div>
            <div className="eclipse-court-role">Resident Court</div>
          </div>

          <div className="eclipse-plus" aria-hidden="true">
            +
          </div>

          <div className="eclipse-court-column">
            <div
              className={`eclipse-court-tile ${
                eclipse.arrivingCard?.color === 'red' ? 'color-red' : 'color-black'
              }`}
            >
              <div className="eclipse-court-short">
                {eclipse.arrivingCard?.shortLabel ?? 'Major'}
              </div>
              <div className="eclipse-court-name">
                {eclipse.arrivingCard?.label ?? 'Arriving Court'}
              </div>
            </div>
            <div className="eclipse-court-role">Arriving Court</div>
          </div>
        </div>

        <div className="eclipse-banner-title">☀ ECLIPSE FORMED — {eclipse.actorName}</div>

        <div className="eclipse-metrics-row">
          <div className="eclipse-metric">
            <div className="eclipse-metric-value">+{eclipse.bonusVP} VP</div>
            <div className="eclipse-metric-label">Permanent reward</div>
          </div>
          <div className="eclipse-metric">
            <div className="eclipse-metric-value">
              {eclipse.eclipseCount} / {eclipse.requiredEclipses}
            </div>
            <div className="eclipse-metric-label">Eclipses earned</div>
          </div>
        </div>

        <p className="eclipse-spotlight-note">
          {eclipse.disposition === 'both_to_veil'
            ? 'Both Courts moved to the Veil so Water can bring them back into circulation. Your permanent Eclipse trophy remains locked beside your Primary Ace.'
            : 'Your permanent Eclipse reward is locked beside your Primary Ace.'}
        </p>

        <button
          type="button"
          className="btn btn-primary"
          data-testid="acknowledge-eclipse-btn"
          onClick={onAcknowledge}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
