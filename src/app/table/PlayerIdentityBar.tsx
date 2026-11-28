import { ELEMENT_META, type ProjectedGameView, type ProjectedPlayerView } from '../../engine/index.js';
import type { PlayControlMode } from '../../sim/botController.js';

export function PlayerIdentityBar({
  view,
  controlMode,
  humanPlayerId,
  isBotActing,
  onQuickActivateBonus
}: {
  view: ProjectedGameView;
  controlMode: PlayControlMode;
  humanPlayerId: string;
  isBotActing: boolean;
  onQuickActivateBonus: (bonusId: string) => void;
}) {
  const isHumanVsBot = controlMode === 'human-vs-bot';
  const requiredEclipses =
    view.ruleset.eclipseVictoryCount === 'players-plus-one'
      ? view.ruleset.playerCount + 1
      : view.ruleset.eclipseVictoryCount;

  const getPlayerRoleTitle = (p: ProjectedPlayerView): string => {
    if (isHumanVsBot) {
      return p.id === humanPlayerId ? 'PLAYER 1 — YOU' : `${p.name.toUpperCase()} — BOT`;
    }
    if (controlMode === 'auto-sim') return `${p.name.toUpperCase()} — SIM BOT`;
    return p.name.toUpperCase();
  };

  const getStatusPill = (p: ProjectedPlayerView): { text: string; tone: string } => {
    if (view.phase === 'AWAITING_MARKET') {
      return { text: 'Trading Market', tone: 'badge-warn' };
    }
    if (view.phase === 'AWAITING_MAJOR_CONTENTION' && view.pendingMajorContention?.playerId === p.id) {
      return { text: 'Major Contention Choice', tone: 'badge-warn' };
    }
    if (p.isCurrentReader && view.phase === 'AWAITING_READING') {
      return {
        text: isHumanVsBot && p.id === humanPlayerId ? 'Your Reading for Bot' : 'Reader',
        tone: 'badge-warn'
      };
    }
    if (p.isActive) {
      if (isHumanVsBot && p.id === humanPlayerId) return { text: 'Your Turn', tone: 'badge-ok' };
      if (isHumanVsBot) return { text: isBotActing ? 'Bot Acting…' : "Bot's Turn", tone: 'badge-ok' };
      return { text: 'Active Turn', tone: 'badge-ok' };
    }
    if (p.isCurrentReader) return { text: 'Reader', tone: '' };
    return { text: 'Waiting', tone: '' };
  };

  return (
    <div className="players-strip">
      {view.players.map((p) => {
        const statusPill = getStatusPill(p);
        const primaryMeta = ELEMENT_META[p.primaryElement];
        const currentMeta = ELEMENT_META[p.lineage.element];
        const topCard = p.lineage.topCard;
        const atPrimaryAce = p.lineage.rank === 1 && p.lineage.stackDepth === 1;
        const readyBonuses = p.pendingReaderBonuses.filter(
          (b) => b.status === 'available' && b.earnedOnTurn < view.turn && Boolean(b.sourceElement)
        );
        const canClickPlayerBonus =
          p.isActive &&
          readyBonuses.length > 0 &&
          (!isHumanVsBot || p.id === humanPlayerId) &&
          !isBotActing &&
          view.phase !== 'AWAITING_READING' &&
          view.phase !== 'AWAITING_MARKET' &&
          view.phase !== 'AWAITING_MAJOR_CONTENTION' &&
          view.phase !== 'AWAITING_EARTH_REORDER';

        return (
          <div
            key={p.id}
            className={`player-identity-card ${p.isActive ? 'player-card-active' : ''}`}
            data-testid={`player-card-${p.id}`}
          >
            <div className="player-identity-top">
              <div className="player-identity-name">
                <span className="player-avatar-dot" aria-hidden="true">
                  {isHumanVsBot && p.id !== humanPlayerId ? '🤖' : '👤'}
                </span>
                <strong>{getPlayerRoleTitle(p)}</strong>
              </div>
              <span className={`badge ${statusPill.tone}`}>{statusPill.text}</span>
            </div>

            <div className="player-identity-body">
              <div className="identity-progression">
                <div
                  className={`identity-ace-box ${
                    p.lineage.primaryAceCard.color === 'red' ? 'color-red' : 'color-black'
                  }`}
                  title={`Permanent Primary Ace Identity: ${p.lineage.primaryAceCard.label}`}
                >
                  <div className="identity-glyph">{p.lineage.primaryAceCard.shortLabel}</div>
                  <div className="identity-caption">Primary Ace · {primaryMeta.label}</div>
                </div>

                <span className="identity-arrow" aria-hidden="true">
                  →
                </span>

                <div
                  className={`identity-current-box ${
                    topCard.color === 'red' ? 'color-red' : 'color-black'
                  }`}
                >
                  <div className="identity-current-row">
                    <span className="identity-glyph">{topCard.shortLabel}</span>
                    <span className="badge">Rank {p.lineage.rank}</span>
                    <span className="badge badge-ok">{topCard.vp} VP</span>
                  </div>
                  <div className="identity-caption">
                    {atPrimaryAce
                      ? `At Primary Ace (${currentMeta.label})`
                      : `Current Lineage · ${currentMeta.label} (${p.evolutionsCompleted} evo)`}
                  </div>
                </div>

                {/* Persistent Eclipse Trophies beside Primary Ace */}
                {p.eclipseTrophies.length > 0 && (
                  <div
                    className="eclipse-trophies-strip"
                    data-testid={`player-eclipse-trophies-${p.id}`}
                  >
                    {p.eclipseTrophies.map((trophy) => (
                      <span
                        key={trophy.id}
                        className="eclipse-trophy-pill"
                        title={`${trophy.label} (earned Turn ${trophy.earnedOnTurn})`}
                      >
                        {trophy.shortLabel}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="player-identity-meta">
                <span className="badge">
                  Hand: {p.handCount}/{view.ruleset.maxHandSize}
                </span>
                {view.ruleset.features.eclipse && (
                  <span
                    className={`badge ${p.eclipseCount > 0 ? 'badge-ok' : ''}`}
                    data-testid={`player-eclipse-count-${p.id}`}
                  >
                    ☀ Eclipse: {p.eclipseCount}/{requiredEclipses}
                    {p.eclipseBonusVP > 0 ? ` (+${p.eclipseBonusVP} VP)` : ''}
                  </span>
                )}
                {p.activeCourtAuraVP > 0 && (
                  <span
                    className="badge badge-ok"
                    title="Active (non-dormant) Classic Court on Board matching your current lineage element"
                  >
                    ✦ Court Aura +{p.activeCourtAuraVP} VP
                  </span>
                )}
                {readyBonuses.length > 0 &&
                  (canClickPlayerBonus ? (
                    <button
                      type="button"
                      className="badge badge-warn badge-clickable"
                      data-testid={`player-bonus-pill-${p.id}`}
                      onClick={() => onQuickActivateBonus(readyBonuses[0]!.id)}
                      title="Click to activate your earned free Tier-1 Reader Bonus right now (0 hand cost)"
                    >
                      ★ {readyBonuses.length} Free{' '}
                      {ELEMENT_META[readyBonuses[0]!.sourceElement!].label} Bonus Ready
                    </button>
                  ) : (
                    <span className="badge badge-warn">
                      ★ {readyBonuses.length} Bonus Ready
                    </span>
                  ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
