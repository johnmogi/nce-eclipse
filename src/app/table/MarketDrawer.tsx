import { useState } from 'react';
import type {
  Card,
  Command,
  ProjectedGameView,
  ProjectedMarketView,
  ProjectedPlayerView
} from '../../engine/index.js';
import { CardTile } from '../components/CardTile.js';

export function MarketDrawer({
  view,
  market,
  viewerPlayer,
  canAct,
  onSendCommand
}: {
  view: ProjectedGameView;
  market: ProjectedMarketView;
  viewerPlayer: ProjectedPlayerView;
  canAct: boolean;
  onSendCommand: (cmd: Command) => void;
}) {
  const [selectedOfferIds, setSelectedOfferIds] = useState<string[]>([]);
  const [requestedCount, setRequestedCount] = useState<number>(1);
  const [selectedCounterIds, setSelectedCounterIds] = useState<string[]>([]);

  const opponent = view.players.find((p) => p.id !== viewerPlayer.id);
  const viewerHand: readonly Card[] = viewerPlayer.hand ?? [];
  const offersMade = market.offersMadeByPlayer[viewerPlayer.id] ?? 0;
  const offersLeft = Math.max(0, market.maxOffersPerPlayer - offersMade);

  const toggleOffer = (cardId: string) => {
    setSelectedOfferIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  };

  const toggleCounter = (cardId: string, maxNeed: number) => {
    setSelectedCounterIds((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= maxNeed) return [...prev.slice(1), cardId];
      return [...prev, cardId];
    });
  };

  const activeOffer = market.activeOffer;

  return (
    <div className="market-panel" data-testid="market-panel">
      <div className="action-row">
        <div>
          <h2 className="decision-title">
            ⚖ Trading Market — After Round {market.openedAfterRound}
          </h2>
          <div className="brand-sub">
            Consensual exchange: 1-for-1 trades, multi-card offers, or 1-way gifts. Acquired cards
            trigger mandatory chained evolution immediately. ({market.completedTrades} completed ·{' '}
            {offersLeft}/{market.maxOffersPerPlayer} offers left)
          </div>
        </div>
        {!activeOffer && (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="close-market-btn"
            disabled={!canAct}
            onClick={() => onSendCommand({ type: 'CloseMarket', playerId: viewerPlayer.id })}
          >
            Close Market &amp; Begin Round {view.round} →
          </button>
        )}
      </div>

      {activeOffer ? (
        <div className="market-offer-box" data-testid="market-active-offer">
          <div className="market-offer-summary">
            <strong>{activeOffer.proposerName}</strong> offers{' '}
            <strong>
              {activeOffer.offerCards.map((c) => `${c.shortLabel} (${c.label})`).join(', ') ||
                'nothing'}
            </strong>{' '}
            to <strong>{activeOffer.targetPlayerName}</strong>{' '}
            {activeOffer.requestedCount === 0
              ? 'as a 1-way gift!'
              : activeOffer.requestCards.length > 0
                ? `for ${activeOffer.requestCards.map((c) => c.shortLabel).join(', ')}`
                : `asking for ${activeOffer.requestedCount} card${
                    activeOffer.requestedCount === 1 ? '' : 's'
                  } in return.`}
          </div>

          {activeOffer.targetPlayerId === viewerPlayer.id &&
            activeOffer.requestedCount > 0 &&
            activeOffer.requestCards.length === 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="brand-sub" style={{ marginBottom: 6 }}>
                  Select {activeOffer.requestedCount} card
                  {activeOffer.requestedCount === 1 ? '' : 's'} from your hand to give in exchange:
                </div>
                <div className="hand-cards-grid">
                  {viewerHand.map((card) => (
                    <CardTile
                      key={card.id}
                      card={card}
                      selected={selectedCounterIds.includes(card.id)}
                      onClick={() => toggleCounter(card.id, activeOffer.requestedCount)}
                    />
                  ))}
                </div>
              </div>
            )}

          <div className="toolbar-group" style={{ marginTop: 10 }}>
            {activeOffer.targetPlayerId === viewerPlayer.id && (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="accept-trade-btn"
                disabled={
                  !canAct ||
                  (activeOffer.requestCards.length === 0 &&
                    selectedCounterIds.length !== activeOffer.requestedCount)
                }
                onClick={() => {
                  onSendCommand({
                    type: 'AcceptTrade',
                    playerId: viewerPlayer.id,
                    offerId: activeOffer.id,
                    counterCardIds:
                      activeOffer.requestCards.length === 0 ? selectedCounterIds : undefined
                  });
                  setSelectedCounterIds([]);
                }}
              >
                {activeOffer.requestedCount === 0 ? 'Accept Gift' : 'Accept Trade'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              data-testid="reject-trade-btn"
              disabled={!canAct}
              onClick={() => {
                onSendCommand({
                  type: 'RejectTrade',
                  playerId: viewerPlayer.id,
                  offerId: activeOffer.id
                });
                setSelectedCounterIds([]);
              }}
            >
              {activeOffer.proposerId === viewerPlayer.id ? 'Withdraw Offer' : 'Decline Offer'}
            </button>
          </div>
        </div>
      ) : (
        <div className="market-compose-box">
          <div className="brand-sub" style={{ marginBottom: 8 }}>
            Click 1 or more cards from your hand below to offer to{' '}
            <strong>{opponent?.name ?? 'Opponent'}</strong> (Lineage:{' '}
            {opponent?.lineage.topCard.shortLabel}, Rank {opponent?.lineage.rank}, Hand:{' '}
            {opponent?.handCount ?? 0}):
          </div>

          {viewerHand.length === 0 ? (
            <div className="brand-sub">Your hand is empty — close Market to begin the next round.</div>
          ) : (
            <div className="hand-cards-grid" data-testid="market-hand-grid">
              {viewerHand.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  subtitle={selectedOfferIds.includes(card.id) ? '✓ Offering' : 'Click to Offer'}
                  selected={selectedOfferIds.includes(card.id)}
                  onClick={() => toggleOffer(card.id)}
                />
              ))}
            </div>
          )}

          <div className="toolbar-group" style={{ marginTop: 10 }}>
            <span className="brand-sub">Ask in return:</span>
            {[1, 2, 0].map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`btn btn-sm ${requestedCount === cnt ? 'btn-active' : ''}`}
                disabled={cnt > (opponent?.handCount ?? 0)}
                data-testid={`market-req-count-${cnt}`}
                onClick={() => setRequestedCount(cnt)}
              >
                {cnt === 0 ? '0 (1-Way Gift)' : `${cnt} card${cnt === 1 ? '' : 's'}`}
              </button>
            ))}

            <button
              type="button"
              className="btn btn-primary"
              data-testid="propose-trade-btn"
              disabled={
                !canAct ||
                !opponent ||
                offersLeft <= 0 ||
                selectedOfferIds.length === 0 ||
                requestedCount > opponent.handCount
              }
              onClick={() => {
                if (!opponent) return;
                onSendCommand({
                  type: 'ProposeTrade',
                  playerId: viewerPlayer.id,
                  targetPlayerId: opponent.id,
                  offerCardIds: selectedOfferIds,
                  requestedCount
                });
                setSelectedOfferIds([]);
              }}
            >
              {requestedCount === 0
                ? `Gift ${selectedOfferIds.length} Card${selectedOfferIds.length === 1 ? '' : 's'}`
                : `Propose Trade (${selectedOfferIds.length} for ${requestedCount})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
