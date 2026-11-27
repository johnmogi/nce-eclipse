import type { PersistedSession } from '../storage.js';

export function SavedGamesPanel({
  sessions,
  activeSessionId,
  onSaveCurrent,
  onResume,
  onDelete,
  onClose
}: {
  sessions: readonly PersistedSession[];
  activeSessionId: string;
  onSaveCurrent: () => void;
  onResume: (session: PersistedSession) => void;
  onDelete: (sessionId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="browser-drawer" data-testid="saved-games-panel">
      <div className="browser-drawer-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong>Saved Games ({sessions.length})</strong>
            <span className="badge badge-ok">Independent Sessions</span>
          </div>
          <div className="brand-sub">
            Each saved game is stored under its own session ID. Clicking New Game never overwrites
            your existing saves.
          </div>
        </div>
        <div className="toolbar-group">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            data-testid="save-current-game-btn"
            onClick={onSaveCurrent}
          >
            + Save Current Game
          </button>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="brand-sub" style={{ padding: '6px 0' }}>
          No saved games yet. Play at least one move (auto-saved under its own session) or click
          “+ Save Current Game” above.
        </div>
      ) : (
        <div className="saved-games-list">
          {sessions.map((s) => {
            const isCurrent = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                className={`saved-game-row ${isCurrent ? 'saved-game-current' : ''}`}
                data-testid={`saved-session-${s.id}`}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong>{s.label}</strong>
                    <span className={`badge ${s.kind === 'manual' ? 'badge-warn' : ''}`}>
                      {s.kind === 'manual' ? 'Manual Save' : 'Auto-Save'}
                    </span>
                    {isCurrent && <span className="badge badge-ok">Active</span>}
                  </div>
                  <div className="brand-sub mono">
                    seed: {s.seed} · R{s.round} T{s.turn} · {s.commands.length} move
                    {s.commands.length === 1 ? '' : 's'} · hash {s.stateHash.slice(0, 8)}
                  </div>
                </div>
                <div className="toolbar-group">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-testid={`resume-session-${s.id}`}
                    onClick={() => onResume(s)}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    data-testid={`delete-session-${s.id}`}
                    onClick={() => onDelete(s.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
