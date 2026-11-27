import { ELEMENT_META, ELEMENTS, type ProjectedGameView, type Viewer } from '../../engine/index.js';

export function DeckView({ view, viewer }: { view: ProjectedGameView; viewer: Viewer }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">
            Card Catalogue (Deck Composition) · {view.deckComponents.length} Cards ({view.ruleset.name})
          </h2>
          <div className="brand-sub">
            Static suit-by-suit card catalogue with visibility-safe known locations. To inspect the
            live ordered draw pile, click <strong>Deck of Days</strong> directly on the Play Table.
          </div>
        </div>
        <span className="badge badge-ok">
          View:{' '}
          {viewer.role === 'admin'
            ? 'Admin (Exact Zones)'
            : `${viewer.playerId.toUpperCase()} (Visibility-Safe)`}
        </span>
      </div>

      <div className="metrics-grid">
        <div className="metric-box">
          <div className="metric-label">Total Cards</div>
          <div className="metric-value">{view.deckComponents.length}</div>
          <div className="brand-sub">
            4 suits × Ranks A–{view.ruleset.maxMinorRank} (No 10s, No Courts until Milestone E)
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Event Realities (Left)</div>
          <div className="metric-value">3 / 2 / 1 VP</div>
          <div className="brand-sub">7–9 Treasure · 4–6 Barrier · 1–3 Trial</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Advantage Cycle</div>
          <div className="metric-value">♥ &gt; ♣ &gt; ♦ &gt; ♠</div>
          <div className="brand-sub">Water &gt; Fire &gt; Earth &gt; Air &gt; Water</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Elemental Verbs (D1)</div>
          <div className="metric-value">1 / Turn</div>
          <div className="brand-sub">♠ Shuffle · ♣ Burn · ♥ Resurface · ♦ Reorder (Card → Veil)</div>
        </div>
      </div>

      <div className="deck-matrix">
        {ELEMENTS.map((el) => {
          const meta = ELEMENT_META[el];
          const suitCards = view.deckComponents.filter((d) => d.card.element === el);
          return (
            <div key={el} className="suit-column">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {meta.suitSymbol} {meta.label} ({meta.classicSuit})
                </strong>
                <span className="badge">{meta.color}</span>
              </div>
              <div className="brand-sub">
                Beats {ELEMENT_META[meta.beats].label} · Vulnerable to{' '}
                {ELEMENT_META[meta.vulnerableTo].label}
              </div>
              {suitCards.map(({ card, knownLocation }) => (
                <div key={card.id} className="deck-row">
                  <span>
                    <strong>{card.shortLabel}</strong> {card.label} ({card.vp} VP)
                  </span>
                  <span className="brand-sub">{knownLocation}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
