import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExportBundle,
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  ELEMENT_META,
  ELEMENTS,
  evaluateReconciliation,
  formatEventsAsText,
  projectView,
  replay,
  RULE_ANNOTATIONS,
  RULESET_PRESETS,
  type Card,
  type Command,
  type EvolutionColorPolicy,
  type EvolutionTieBreakPolicy,
  type ExportBundle,
  type GameState,
  type PlayerState,
  type Ruleset,
  type Viewer
} from '../engine/index.js';
import { chooseNextCommand, chooseReaderAdvice, type AgentPolicyId } from '../sim/agents.js';
import { formatBatchAsCsv, formatBatchAsText } from '../sim/formatters.js';
import { runSimulationBatch, type BatchSimulationSummary } from '../sim/runner.js';
import { loadActiveSession, saveActiveSession } from './storage.js';

type ActiveTab = 'play' | 'deck' | 'rules' | 'lab';

const DEFAULT_PRESET_ID = 'poker-proto-c';

function CardTile({
  card,
  subtitle,
  selected,
  onClick
}: {
  card: Card;
  subtitle?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const colorClass = card.color === 'red' ? 'color-red' : 'color-black';
  return (
    <div
      className={`card-chip ${colorClass} ${onClick ? 'clickable' : ''} ${selected ? 'selected-sacrifice' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="card-top">
        <span>{card.shortLabel}</span>
        <span className="badge">{card.vp} VP</span>
      </div>
      <div className="card-meta">{card.label}</div>
      <div className="card-meta">
        {card.element ? `${ELEMENT_META[card.element].label} · ${card.color}` : card.family}
      </div>
      {subtitle && <div className="card-meta">{subtitle}</div>}
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tab, setTab] = useState<ActiveTab>('play');
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);

  const [ruleset, setRuleset] = useState<Ruleset>(RULESET_PRESETS[DEFAULT_PRESET_ID]!);
  const [seed, setSeed] = useState<string>('eclipse-mc-001');
  const [liveState, setLiveState] = useState<GameState>(() =>
    createGame(RULESET_PRESETS[DEFAULT_PRESET_ID]!, 'eclipse-mc-001')
  );
  const [viewer, setViewer] = useState<Viewer>({ role: 'player', playerId: 'p1' });
  const [timelineStep, setTimelineStep] = useState<number | null>(null);
  const [autoPlayMode, setAutoPlayMode] = useState<'off' | 'live' | 'replay'>('off');
  const [autoPlayMs, setAutoPlayMs] = useState<number>(850);
  const [readerBotPolicy, setReaderBotPolicy] = useState<AgentPolicyId>('bluffing-rival');
  const [selectedSacrificeIds, setSelectedSacrificeIds] = useState<string[]>([]);
  const [storageKind, setStorageKind] = useState<string>('local');
  const [notice, setNotice] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Ruleset editor draft state
  const [draftColors, setDraftColors] = useState<EvolutionColorPolicy>(ruleset.allowedEvolutionColors);
  const [draftJump, setDraftJump] = useState<number>(ruleset.maxEvolutionJump);
  const [draftTieBreak, setDraftTieBreak] = useState<EvolutionTieBreakPolicy>(ruleset.evolutionTieBreak);
  const [draftStartHand, setDraftStartHand] = useState<number>(ruleset.startingHandSize);
  const [draftMaxHand, setDraftMaxHand] = useState<number>(ruleset.maxHandSize);
  const [draftReaderBonusOnAbandon, setDraftReaderBonusOnAbandon] = useState<boolean>(
    ruleset.readerBonusOnAbandon
  );
  const [draftTrialTarget, setDraftTrialTarget] = useState<'event' | 'center'>(
    ruleset.trialTargetElement
  );
  const [draftTrialBonusVP, setDraftTrialBonusVP] = useState<number>(ruleset.trialAdvantageBonusVP);
  const [draftHintsEnabled, setDraftHintsEnabled] = useState<boolean>(ruleset.readingTierHintsEnabled);
  const [draftSeedInput, setDraftSeedInput] = useState<string>(seed);

  // Batch simulation lab state
  const [simRuns, setSimRuns] = useState<number>(500);
  const [simPolicy, setSimPolicy] = useState<AgentPolicyId>('bluffing-rival');
  const [simSeedPrefix, setSimSeedPrefix] = useState<string>('lab-mc');
  const [simSummary, setSimSummary] = useState<BatchSimulationSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void loadActiveSession().then((saved) => {
      if (cancelled) return;
      hydratedRef.current = true;
      if (!saved || saved.ruleset.version !== '1.3.0') return;
      const rep = replay(saved.seed, saved.ruleset, saved.commands);
      if (rep.ok) {
        setRuleset(saved.ruleset);
        setSeed(saved.seed);
        setDraftSeedInput(saved.seed);
        syncDraftFromRuleset(saved.ruleset);
        setLiveState(rep.finalState);
        setStorageKind('restored');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveActiveSession({
      seed: liveState.seed,
      ruleset: liveState.ruleset,
      commands: liveState.commandHistory.map((r) => r.command),
      updatedAt: new Date().toISOString()
    }).then((kind) => setStorageKind(kind));
  }, [liveState]);

  // Clear sacrifice selection whenever phase or turn changes
  useEffect(() => {
    setSelectedSacrificeIds([]);
  }, [liveState.phase, liveState.turn, liveState.activePlayerId]);

  function syncDraftFromRuleset(r: Ruleset) {
    setDraftColors(r.allowedEvolutionColors);
    setDraftJump(r.maxEvolutionJump);
    setDraftTieBreak(r.evolutionTieBreak);
    setDraftStartHand(r.startingHandSize);
    setDraftMaxHand(r.maxHandSize);
    setDraftReaderBonusOnAbandon(r.readerBonusOnAbandon);
    setDraftTrialTarget(r.trialTargetElement);
    setDraftTrialBonusVP(r.trialAdvantageBonusVP);
    setDraftHintsEnabled(r.readingTierHintsEnabled);
  }

  const timelineSnapshots = useMemo(() => {
    const cmds = liveState.commandHistory.map((r) => r.command);
    const rep = replay(liveState.seed, liveState.ruleset, cmds);
    return rep.snapshots;
  }, [liveState]);

  useEffect(() => {
    if (autoPlayMode === 'off') return;

    const timer = window.setInterval(() => {
      if (autoPlayMode === 'replay') {
        setTimelineStep((prev) => {
          const current = prev ?? 0;
          const next = current + 1;
          if (next >= timelineSnapshots.length - 1) {
            setAutoPlayMode('off');
            return null;
          }
          return next;
        });
      } else if (autoPlayMode === 'live') {
        setLiveState((prev) => {
          if (prev.status !== 'playing') {
            setAutoPlayMode('off');
            return prev;
          }
          const cmd = chooseNextCommand(prev, readerBotPolicy);
          if (!cmd) {
            setAutoPlayMode('off');
            return prev;
          }
          const res = dispatch(prev, cmd);
          if (!res.ok || res.state.status !== 'playing') {
            setAutoPlayMode('off');
          }
          return res.state;
        });
      }
    }, autoPlayMs);

    return () => window.clearInterval(timer);
  }, [autoPlayMode, autoPlayMs, readerBotPolicy, timelineSnapshots.length]);

  const inspectedState: GameState = useMemo(() => {
    if (timelineStep === null) return liveState;
    const clamped = Math.max(0, Math.min(timelineStep, timelineSnapshots.length - 1));
    return timelineSnapshots[clamped]?.state ?? liveState;
  }, [liveState, timelineSnapshots, timelineStep]);

  const isViewingHistory =
    timelineStep !== null && timelineStep < timelineSnapshots.length - 1;

  const view = useMemo(() => projectView(inspectedState, viewer), [inspectedState, viewer]);
  const invariantReport = useMemo(() => checkInvariants(inspectedState), [inspectedState]);

  const activePlayer = view.players.find((p) => p.id === view.activePlayerId)!;

  // Live Barrier/Trial reconciliation calculator (strictly visibility-safe!)
  const liveReconciliation = useMemo(() => {
    if (view.phase !== 'AWAITING_EVENT_RESOLUTION') return null;
    const evItem = view.board.event[0];
    const centerItem = view.board.center[0];
    if (!evItem || evItem.hidden || !centerItem || centerItem.hidden) return null;

    const catalogSubset: Record<string, Card> = {
      [evItem.card.id]: evItem.card,
      [centerItem.card.id]: centerItem.card,
      [activePlayer.lineage.topCard.id]: activePlayer.lineage.topCard
    };
    if (activePlayer.hand) {
      for (const c of activePlayer.hand) catalogSubset[c.id] = c;
    }

    const simPlayer: PlayerState = {
      id: activePlayer.id,
      name: activePlayer.name,
      primaryElement: activePlayer.primaryElement,
      lineage: {
        rank: activePlayer.lineage.rank,
        element: activePlayer.lineage.element,
        color: activePlayer.lineage.color,
        cardIds: activePlayer.lineage.cardIds
      },
      hand: activePlayer.hand ? activePlayer.hand.map((c) => c.id) : [],
      eclipseCount: activePlayer.eclipseCount,
      effectUsedThisTurn: false,
      pendingReaderBonuses: activePlayer.pendingReaderBonuses,
      evolutionsCompleted: activePlayer.evolutionsCompleted,
      maxChainLength: activePlayer.maxChainLength,
      turnsTaken: activePlayer.turnsTaken
    };

    const validSacIds = selectedSacrificeIds.filter((id) => simPlayer.hand.includes(id));

    return evaluateReconciliation({
      player: simPlayer,
      eventCard: evItem.card,
      centerCard: centerItem.card,
      sacrificeCardIds: validSacIds,
      cards: catalogSubset,
      ruleset: view.ruleset
    });
  }, [view, activePlayer, selectedSacrificeIds]);

  function flashCopy(label: string) {
    setCopyFeedback(label);
    window.setTimeout(() => setCopyFeedback(null), 1800);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopy(label);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      flashCopy(label);
    }
  }

  function startNewGame(
    nextRuleset: Ruleset,
    nextSeed: string,
    initialCommands: readonly Command[] = [],
    options: { startAtStepZero?: boolean; autoPlayReplay?: boolean } = {}
  ) {
    setAutoPlayMode('off');
    setSelectedSacrificeIds([]);
    const rep = replay(nextSeed, nextRuleset, initialCommands);
    if (!rep.ok) {
      setNotice(`Failed to initialize seed "${nextSeed}": ${rep.error?.message ?? 'unknown error'}`);
      return;
    }
    setRuleset(nextRuleset);
    setSeed(nextSeed);
    setDraftSeedInput(nextSeed);
    syncDraftFromRuleset(nextRuleset);
    setLiveState(rep.finalState);
    if (options.startAtStepZero && initialCommands.length > 0) {
      setTimelineStep(0);
      setInspectorOpen(true);
      if (options.autoPlayReplay) {
        setAutoPlayMode('replay');
      }
    } else {
      setTimelineStep(null);
    }
    setNotice(null);
  }

  function sendCommand(command: Command) {
    setAutoPlayMode('off');
    if (isViewingHistory) {
      setNotice('Timeline is paused on a historical step. Click “Return to Live” to play.');
      return;
    }
    const res = dispatch(liveState, command);
    setLiveState(res.state);
    if (!res.ok) {
      setNotice(`Rejected (${res.error.code}): ${res.error.message}`);
    } else {
      setNotice(null);
    }
  }

  function triggerBotReading() {
    if (isViewingHistory || liveState.phase !== 'AWAITING_READING' || !liveState.currentReading) return;
    const advice = chooseReaderAdvice(liveState, readerBotPolicy);
    sendCommand({
      type: 'GiveReading',
      playerId: liveState.currentReading.readerId,
      advice
    });
  }

  function stepOneBotMove() {
    setAutoPlayMode('off');
    if (isViewingHistory) {
      const next = (timelineStep ?? 0) + 1;
      setTimelineStep(next >= timelineSnapshots.length - 1 ? null : next);
      return;
    }
    const nextCmd = chooseNextCommand(liveState, readerBotPolicy);
    if (!nextCmd) return;
    sendCommand(nextCmd);
  }

  function toggleAutoWatch() {
    if (autoPlayMode !== 'off') {
      setAutoPlayMode('off');
      return;
    }
    if (isViewingHistory) {
      setAutoPlayMode('replay');
      return;
    }
    if (liveState.status === 'completed' && timelineSnapshots.length > 1) {
      setTimelineStep(0);
      setAutoPlayMode('replay');
      return;
    }
    setAutoPlayMode('live');
  }

  function toggleSacrifice(cardId: string) {
    setSelectedSacrificeIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  }

  function downloadBlob(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportJson(exportViewer: Viewer) {
    const bundle = buildExportBundle(inspectedState, exportViewer);
    const suffix = exportViewer.role === 'admin' ? 'admin-replay' : `player-${exportViewer.playerId}`;
    downloadBlob(
      `nce-${inspectedState.seed}-${suffix}.json`,
      JSON.stringify(bundle, null, 2),
      'application/json'
    );
  }

  function handleExportTxt() {
    const text = formatEventsAsText(view);
    const suffix = viewer.role === 'admin' ? 'admin-log' : `player-${viewer.playerId}-log`;
    downloadBlob(`nce-${view.seed}-${suffix}.txt`, text, 'text/plain');
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as ExportBundle;
        if (!parsed.seed || !parsed.ruleset || !Array.isArray(parsed.commands)) {
          setNotice('Import requires an Admin export JSON bundle containing seed, ruleset, and commands.');
          return;
        }
        const rep = replay(parsed.seed, parsed.ruleset, parsed.commands);
        if (!rep.ok) {
          setNotice(`Replay failed at command #${rep.failedAtCommandIndex}: ${rep.error?.message}`);
          return;
        }
        const hashMatches = rep.finalState.stateHash === parsed.finalStateHash;
        setRuleset(parsed.ruleset);
        setSeed(parsed.seed);
        setDraftSeedInput(parsed.seed);
        syncDraftFromRuleset(parsed.ruleset);
        setLiveState(rep.finalState);
        setTimelineStep(0);
        setInspectorOpen(true);
        setAutoPlayMode('off');
        setNotice(
          hashMatches
            ? `Imported & verified replay (${parsed.commands.length} commands · hash ${rep.finalState.stateHash} exact match).`
            : `Imported replay (${parsed.commands.length} commands) — warning: state hash differed.`
        );
      } catch (err) {
        setNotice(`Invalid JSON file: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    e.target.value = '';
  }

  function applyCustomRuleset() {
    const updated = cloneRulesetWithOverrides(ruleset, {
      id: `${ruleset.id}-custom`,
      allowedEvolutionColors: draftColors,
      maxEvolutionJump: draftJump,
      evolutionTieBreak: draftTieBreak,
      startingHandSize: draftStartHand,
      maxHandSize: draftMaxHand,
      readerBonusOnAbandon: draftReaderBonusOnAbandon,
      trialTargetElement: draftTrialTarget,
      trialAdvantageBonusVP: draftTrialBonusVP,
      readingTierHintsEnabled: draftHintsEnabled
    });
    startNewGame(updated, draftSeedInput.trim() || 'custom-seed');
    setTab('play');
  }

  function runLabBatch(count: number) {
    setSimRuns(count);
    const summary = runSimulationBatch({
      ruleset,
      runs: count,
      seedPrefix: simSeedPrefix.trim() || 'lab-mc',
      policy: simPolicy,
      verifyReplaySample: Math.min(count, 25),
      maxSampleRuns: 30
    });
    setSimSummary(summary);
  }

  const canActAsActivePlayer =
    !isViewingHistory &&
    view.status === 'playing' &&
    (viewer.role === 'admin' || viewer.playerId === view.activePlayerId);

  const canActAsReader =
    !isViewingHistory &&
    view.status === 'playing' &&
    view.phase === 'AWAITING_READING' &&
    view.currentReading !== null &&
    (viewer.role === 'admin' || viewer.playerId === view.currentReading.readerId);

  const currentStepIndex = timelineStep ?? timelineSnapshots.length - 1;
  const maxStepIndex = Math.max(0, timelineSnapshots.length - 1);

  const prototypePresets = Object.values(RULESET_PRESETS).filter((r) => r.category === 'prototype');
  const tutorialPresets = Object.values(RULESET_PRESETS).filter((r) => r.category === 'tutorial');

  return (
    <div className="app-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="brand">
          <h1>NEXUS ECLIPSE · {view.ruleset.category === 'prototype' ? 'Poker Prototype' : `Tutorial ${view.ruleset.tutorialLevel}`}</h1>
          <div className="brand-sub">
            {view.ruleset.name} · Deck: {view.deckComponents.length} cards · Storage: {storageKind}
          </div>
        </div>

        <div className="toolbar-group">
          <div className="tabs">
            <button className={`btn ${tab === 'play' ? 'btn-active' : ''}`} onClick={() => setTab('play')}>
              Play Table
            </button>
            <button className={`btn ${tab === 'deck' ? 'btn-active' : ''}`} onClick={() => setTab('deck')}>
              Deck ({view.deckComponents.length})
            </button>
            <button className={`btn ${tab === 'rules' ? 'btn-active' : ''}`} onClick={() => setTab('rules')}>
              Rules
            </button>
            <button className={`btn ${tab === 'lab' ? 'btn-active' : ''}`} onClick={() => setTab('lab')}>
              Simulation Lab
            </button>
          </div>
          <button className="btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      {/* Mode & Viewpoint Strip */}
      <div className="topbar">
        <div className="toolbar-group">
          <span className="brand-sub">Mode:</span>
          <select
            className="select"
            aria-label="Select game mode or tutorial"
            value={ruleset.id}
            onChange={(e) => {
              const found = RULESET_PRESETS[e.target.value];
              if (found) startNewGame(found, draftSeedInput.trim() || 'eclipse-mc-001');
            }}
          >
            <optgroup label="Integrated Game (Poker Prototype)">
              {prototypePresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Isolated Instructional Tutorials">
              {tutorialPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>

          <input
            className="input mono"
            style={{ width: 135 }}
            value={draftSeedInput}
            onChange={(e) => setDraftSeedInput(e.target.value)}
            placeholder="seed"
          />
          <button
            className="btn"
            onClick={() => startNewGame(ruleset, draftSeedInput.trim() || 'eclipse-mc-001')}
          >
            New Game
          </button>
        </div>

        <div className="toolbar-group">
          <span className="brand-sub">View:</span>
          {view.players.map((p) => (
            <button
              key={p.id}
              className={`btn btn-sm ${
                viewer.role === 'player' && viewer.playerId === p.id ? 'btn-active' : ''
              }`}
              onClick={() => setViewer({ role: 'player', playerId: p.id })}
            >
              {p.name}
              {p.isCurrentReader ? ' (Reader)' : p.isActive ? ' (Active)' : ''}
            </button>
          ))}
          <button
            className={`btn btn-sm ${viewer.role === 'admin' ? 'btn-active' : ''}`}
            onClick={() => setViewer({ role: 'admin' })}
          >
            Admin (God Mode)
          </button>
          {tab === 'play' && (
            <button
              className={`btn btn-sm ${inspectorOpen ? 'btn-active' : ''}`}
              onClick={() => setInspectorOpen((o) => !o)}
            >
              {inspectorOpen ? 'Hide Inspector' : `Inspector & Log (${view.events.length})`}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="banner-warn">{notice}</div>}
      {copyFeedback && <div className="banner-ok">{copyFeedback}</div>}

      {/* ===================================================================== */}
      {/* TAB 1: BOARD-FIRST PLAY TABLE (+ COLLAPSIBLE INSPECTOR DRAWER)        */}
      {/* ===================================================================== */}
      {tab === 'play' && (
        <div className={inspectorOpen ? 'stage-with-drawer' : 'stage-single'}>
          {/* Primary Game Table */}
          <section className="panel">
            {/* Compact Status Header */}
            <div className="panel-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>
                  Round {view.round} · Turn {view.turn}
                </strong>
                <span className="badge badge-ok">
                  {view.ruleset.category === 'prototype' ? 'Poker Prototype (36 Minors)' : `Tutorial ${view.ruleset.tutorialLevel}`}
                </span>
                <span className="badge">Days Left: {view.daysCount}</span>
                <span className="badge">Veil: {view.veil.length}</span>
              </div>

              <div className="toolbar-group">
                <button
                  className={`btn btn-sm ${autoPlayMode !== 'off' ? 'btn-danger' : ''}`}
                  onClick={toggleAutoWatch}
                >
                  {autoPlayMode !== 'off'
                    ? '⏸ Pause'
                    : view.status === 'completed'
                      ? '▶ Replay'
                      : '▶ Auto-Watch'}
                </button>
                <button
                  className="btn btn-sm"
                  disabled={!isViewingHistory && view.status !== 'playing'}
                  onClick={stepOneBotMove}
                >
                  ⏭ Bot Step
                </button>
              </div>
            </div>

            {isViewingHistory && (
              <div className="banner-warn">
                <strong>Inspecting History (Step {currentStepIndex}/{maxStepIndex}):</strong> Read-only
                view — live history untouched.{' '}
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    setAutoPlayMode('off');
                    setTimelineStep(null);
                  }}
                >
                  Return to Live
                </button>
              </div>
            )}

            {/* Prominent 3-Slot Shared Board */}
            <div className="board-row">
              {/* LEFT: EVENT MODIFIER */}
              <div
                className={`zone-slot ${
                  !view.ruleset.features.barriersAndTrials
                    ? 'inactive-slot'
                    : view.phase === 'AWAITING_EVENT_RESOLUTION'
                      ? 'active-center'
                      : ''
                }`}
              >
                <div className="zone-label">
                  <span>Left · Event Modifier</span>
                  <span>
                    {!view.ruleset.features.barriersAndTrials
                      ? 'Tutorial Locked'
                      : view.eventRevealed && view.eventReality
                        ? view.eventReality.toUpperCase()
                        : 'Concealed'}
                  </span>
                </div>
                <div className="board-card-hero">
                  {!view.ruleset.features.barriersAndTrials ? (
                    <span className="brand-sub">Inactive in isolated tutorial. Switch to Poker Prototype.</span>
                  ) : view.board.event.length === 0 ? (
                    <span className="brand-sub">Resolved (moved to Veil)</span>
                  ) : (
                    view.board.event.map((item, idx) =>
                      item.hidden ? (
                        <div key={`ev-hid-${idx}`} className="card-back">
                          <div className="card-back-sigil">?</div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>Event Modifier</div>
                          <div className="card-meta">Reveals if you Pursue Center</div>
                        </div>
                      ) : (
                        <div key={item.card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div className="board-glyph">{item.card.shortLabel}</div>
                          <div>
                            <strong>
                              {view.eventReality === 'treasure'
                                ? 'Treasure · 3 VP (Free)'
                                : view.eventReality === 'barrier'
                                  ? `Barrier · ${item.card.vp} VP`
                                  : `Trial · > ${item.card.vp} VP`}
                            </strong>
                          </div>
                          <div className="card-meta">
                            {item.card.label}
                            {item.privateToReader ? ' (Admin peek)' : ''}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </div>

              {/* CENTER: CONCEALED READING / ACTIVE OPPORTUNITY */}
              <div
                className={`zone-slot ${
                  view.phase === 'AWAITING_READING' ||
                  view.phase === 'AWAITING_READING_DECISION' ||
                  view.phase === 'AWAITING_ABANDONED_CHOICE'
                    ? 'active-center'
                    : ''
                }`}
              >
                <div className="zone-label">
                  <span>Center · Opportunity</span>
                  <span>
                    {view.centerAbandoned
                      ? 'Abandoned (Free Claim)'
                      : view.centerRevealed
                        ? 'Revealed'
                        : 'Concealed'}
                  </span>
                </div>
                <div className="board-card-hero">
                  {view.board.center.length === 0 ? (
                    <span className="brand-sub">Empty — ready for next turn</span>
                  ) : (
                    view.board.center.map((item, idx) =>
                      item.hidden ? (
                        <div key={`ctr-hid-${idx}`} className="card-back">
                          <div className="card-back-sigil">?</div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>Concealed Center</div>
                          <div className="card-meta">Back: {item.backGroup}</div>
                        </div>
                      ) : (
                        <div key={item.card.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div className="board-glyph">{item.card.shortLabel}</div>
                          <div>
                            <strong>{item.card.label}</strong> ({item.card.vp} VP)
                          </div>
                          <div className="card-meta">
                            {item.privateToReader
                              ? 'Reader Peek (hidden from Active Player)'
                              : view.centerAbandoned
                                ? 'Abandoned — claim as free Treasure or decline'
                                : 'Revealed opportunity'}
                          </div>
                        </div>
                      )
                    )
                  )}
                </div>
              </div>

              {/* RIGHT: PARALLEL DIMENSION (DEFERRED TO MILESTONE E) */}
              <div className="zone-slot inactive-slot">
                <div className="zone-label">
                  <span>Right · Parallel Dim</span>
                  <span>Milestone E</span>
                </div>
                <div className="board-card-hero">
                  <div className="board-glyph" style={{ opacity: 0.45 }}>◇</div>
                  <div className="card-meta">Majors &amp; Eclipse arrive in Milestone E</div>
                </div>
              </div>
            </div>

            {/* PROMINENT CURRENT DECISION PANEL */}
            <div className="decision-hero">
              {view.status === 'completed' && view.outcome ? (
                <>
                  <h2 className="decision-title">Game Complete — {view.outcome.summary}</h2>
                  <div className="toolbar-group">
                    <button
                      className="btn btn-primary"
                      onClick={() => startNewGame(ruleset, `${seed}-next`)}
                    >
                      Play Another Seed
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setInspectorOpen(true);
                        setTimelineStep(0);
                        setAutoPlayMode('replay');
                      }}
                    >
                      ▶ Watch Full Replay
                    </button>
                  </div>
                </>
              ) : view.phase === 'AWAITING_ABANDONED_CHOICE' ? (
                <>
                  <h2 className="decision-title">
                    {activePlayer.name}: Claim the abandoned Center card for free?
                  </h2>
                  <div className="brand-sub">
                    The previous player abandoned this obstacle. You may claim it directly as a free
                    Treasure (forfeiting your reading this turn), or decline it to the Veil and take a
                    fresh concealed reading.
                  </div>
                  <div className="toolbar-group">
                    <button
                      className="btn btn-primary"
                      disabled={!canActAsActivePlayer}
                      onClick={() =>
                        sendCommand({ type: 'ClaimAbandonedCard', playerId: view.activePlayerId })
                      }
                    >
                      Claim as Free Treasure (Skip Reading)
                    </button>
                    <button
                      className="btn"
                      disabled={!canActAsActivePlayer}
                      onClick={() =>
                        sendCommand({ type: 'DeclineAbandonedCard', playerId: view.activePlayerId })
                      }
                    >
                      Decline to Veil &amp; Take Fresh Reading
                    </button>
                  </div>
                </>
              ) : view.phase === 'AWAITING_READING' && view.currentReading ? (
                <>
                  <h2 className="decision-title">
                    {canActAsReader
                      ? `Reader (${view.currentReading.readerName}): Inspect Center & Advise ${activePlayer.name}`
                      : `Waiting for ${view.currentReading.readerName}'s Reading`}
                  </h2>
                  <div className="brand-sub">
                    {canActAsReader
                      ? `You see Center privately (${activePlayer.name} cannot). Advise GOOD or BAD — you may be honest or bluff. You earn a pending bonus if ${activePlayer.name} follows BAD to discard, or follows GOOD and successfully claims the card.`
                      : `Center is concealed. ${view.currentReading.readerName} peeks at it and tells you GOOD or BAD before you decide whether to Pursue or Discard.`}
                  </div>
                  <div className="toolbar-group">
                    {canActAsReader ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            sendCommand({
                              type: 'GiveReading',
                              playerId: view.currentReading!.readerId,
                              advice: 'good'
                            })
                          }
                        >
                          Advise: GOOD
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() =>
                            sendCommand({
                              type: 'GiveReading',
                              playerId: view.currentReading!.readerId,
                              advice: 'bad'
                            })
                          }
                        >
                          Advise: BAD
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-primary" disabled={isViewingHistory} onClick={triggerBotReading}>
                          Receive Bot Reading ({readerBotPolicy === 'bluffing-rival' ? 'Rival AI' : 'Honest AI'})
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            setViewer({ role: 'player', playerId: view.currentReading!.readerId })
                          }
                        >
                          Switch to {view.currentReading.readerName} (Hotseat)
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : view.phase === 'AWAITING_READING_DECISION' && view.currentReading?.advice ? (
                <>
                  <h2 className="decision-title">
                    {view.currentReading.readerName} advises{' '}
                    <span className={view.currentReading.advice === 'good' ? 'badge badge-ok' : 'badge badge-danger'}>
                      {view.currentReading.advice.toUpperCase()}
                    </span>{' '}
                    — {activePlayer.name}, Pursue or Discard?
                  </h2>
                  <div className="brand-sub">
                    {view.ruleset.features.barriersAndTrials
                      ? 'Pursuing reveals Center and the Left Event (Treasure, Barrier, or Trial). Discarding sends Center straight to the Veil.'
                      : 'Pursuing reveals and claims Center. Discarding sends it to the Veil.'}{' '}
                    {view.currentReading.advice === 'good'
                      ? `(Following GOOD earns ${view.currentReading.readerName} a bonus only if you claim the card.)`
                      : `(Following BAD to discard earns ${view.currentReading.readerName} a bonus even if they bluffed.)`}
                  </div>
                  <div className="toolbar-group">
                    {canActAsActivePlayer ? (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => sendCommand({ type: 'PursueCenter', playerId: view.activePlayerId })}
                        >
                          Pursue Center Card
                        </button>
                        <button
                          className="btn"
                          onClick={() => sendCommand({ type: 'DiscardCenter', playerId: view.activePlayerId })}
                        >
                          Discard Center to Veil
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => setViewer({ role: 'player', playerId: view.activePlayerId })}
                      >
                        Hand Back to {activePlayer.name}
                      </button>
                    )}
                  </div>
                </>
              ) : view.phase === 'AWAITING_EVENT_RESOLUTION' && liveReconciliation ? (
                <>
                  <h2 className="decision-title">
                    {liveReconciliation.reality === 'treasure'
                      ? `Treasure Revealed! Claim Center Freely`
                      : liveReconciliation.reality === 'barrier'
                        ? `Barrier (${liveReconciliation.eventVP} VP) — Reconcile or Abandon`
                        : `Elemental Trial (> ${liveReconciliation.eventVP} VP) — Reconcile or Abandon`}
                  </h2>
                  <div className="brand-sub">{liveReconciliation.requiredCondition}</div>

                  {liveReconciliation.reality !== 'treasure' && (
                    <div className="calc-strip">
                      <span>
                        <strong>Lineage:</strong> {liveReconciliation.lineageVP} VP
                      </span>
                      <span>+</span>
                      <span>
                        <strong>Sacrifice ({selectedSacrificeIds.length}):</strong>{' '}
                        {liveReconciliation.sacrificedVP} VP
                      </span>
                      {liveReconciliation.reality === 'trial' && (
                        <>
                          <span>+</span>
                          <span>
                            <strong>
                              Elemental Advantage (beat {liveReconciliation.targetElement}):
                            </strong>{' '}
                            {liveReconciliation.hasElementalAdvantage
                              ? `+${liveReconciliation.advantageModifierVP} VP ✓`
                              : 'Missing ✗'}
                          </span>
                        </>
                      )}
                      <span>=</span>
                      <span className={`badge ${liveReconciliation.passes ? 'badge-ok' : 'badge-warn'}`}>
                        Effective: {liveReconciliation.effectiveVP} VP
                        {liveReconciliation.wasCapped ? ` (capped at ${liveReconciliation.capLimit})` : ''}
                      </span>
                      {liveReconciliation.failureReason && (
                        <span className="brand-sub">· Click hand cards below to sacrifice</span>
                      )}
                    </div>
                  )}

                  <div className="toolbar-group">
                    <button
                      className="btn btn-primary"
                      disabled={!canActAsActivePlayer || !liveReconciliation.passes}
                      onClick={() =>
                        sendCommand({
                          type: 'ResolveEvent',
                          playerId: view.activePlayerId,
                          sacrificeCardIds: selectedSacrificeIds
                        })
                      }
                    >
                      {liveReconciliation.reality === 'treasure'
                        ? 'Claim Treasure'
                        : liveReconciliation.reality === 'barrier'
                          ? `Reconcile Barrier (${selectedSacrificeIds.length} sacrifice)`
                          : `Pass Trial (${selectedSacrificeIds.length} sacrifice)`}
                    </button>

                    {liveReconciliation.reality !== 'treasure' && (
                      <button
                        className="btn"
                        disabled={!canActAsActivePlayer}
                        onClick={() =>
                          sendCommand({ type: 'AbandonCenter', playerId: view.activePlayerId })
                        }
                      >
                        Abandon Center (Leave for Next Player)
                      </button>
                    )}

                    {selectedSacrificeIds.length > 0 && (
                      <button className="btn btn-sm" onClick={() => setSelectedSacrificeIds([])}>
                        Clear Selection
                      </button>
                    )}
                  </div>
                </>
              ) : view.phase === 'AWAITING_HAND_DISCARD' ? (
                <>
                  <h2 className="decision-title">
                    {activePlayer.name}: Discard down to {view.ruleset.maxHandSize} cards
                  </h2>
                  <div className="brand-sub">Click a card in {activePlayer.name}&apos;s hand below to send it to the Veil.</div>
                </>
              ) : view.phase === 'AWAITING_CENTER_DECISION' ? (
                <>
                  <h2 className="decision-title">Tutorial 1.1: Claim or Discard Center</h2>
                  <div className="toolbar-group">
                    <button
                      className="btn btn-primary"
                      disabled={!canActAsActivePlayer}
                      onClick={() => sendCommand({ type: 'ClaimCenterCard', playerId: view.activePlayerId })}
                    >
                      Claim Center Card
                    </button>
                    <button
                      className="btn"
                      disabled={!canActAsActivePlayer}
                      onClick={() => sendCommand({ type: 'DiscardCenterCard', playerId: view.activePlayerId })}
                    >
                      Discard to Veil
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="decision-title">{activePlayer.name}: Turn Resolved</h2>
                  <div className="brand-sub">Finish turn to pass play and refresh the board.</div>
                  <div className="toolbar-group">
                    <button
                      className="btn btn-primary"
                      disabled={!canActAsActivePlayer}
                      onClick={() => sendCommand({ type: 'EndTurn', playerId: view.activePlayerId })}
                    >
                      Finish Turn →
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Players Strip: Lineage & Hands */}
            <div className="players-grid">
              {view.players.map((p) => {
                const canSelectSacrifice =
                  view.phase === 'AWAITING_EVENT_RESOLUTION' &&
                  liveReconciliation?.reality !== 'treasure' &&
                  p.id === view.activePlayerId &&
                  canActAsActivePlayer;
                const needsHandDiscard =
                  view.phase === 'AWAITING_HAND_DISCARD' &&
                  p.id === view.activePlayerId &&
                  canActAsActivePlayer;

                return (
                  <div key={p.id} className={`player-card ${p.isActive ? 'is-active' : ''}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong>
                        {p.name} {p.isActive ? '● Active' : p.isCurrentReader ? '◉ Reader' : ''}
                      </strong>
                      <div className="toolbar-group">
                        <span className="badge badge-ok">
                          Rank {p.lineage.rank} ({p.lineage.topCard.vp} VP)
                        </span>
                        {p.pendingReaderBonusCount > 0 && (
                          <span className="badge badge-warn">
                            +{p.pendingReaderBonusCount} Reader Bonus
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="brand-sub" style={{ marginBottom: 4 }}>
                        Lineage ({p.evolutionsCompleted} evo · stack {p.lineage.stackDepth})
                      </div>
                      <CardTile card={p.lineage.topCard} />
                    </div>

                    <div>
                      <div className="brand-sub" style={{ marginBottom: 4 }}>
                        Hand ({p.handCount}/{view.ruleset.maxHandSize})
                        {canSelectSacrifice
                          ? ' — Click cards to sacrifice'
                          : needsHandDiscard
                            ? ' — Click card to discard'
                            : ''}
                      </div>
                      {p.hand === null ? (
                        <div className="badge">Hidden ({p.handCount} cards)</div>
                      ) : p.hand.length === 0 ? (
                        <span className="brand-sub">Empty hand</span>
                      ) : (
                        <div className="card-list">
                          {p.hand.map((card) => (
                            <CardTile
                              key={card.id}
                              card={card}
                              selected={canSelectSacrifice && selectedSacrificeIds.includes(card.id)}
                              onClick={
                                canSelectSacrifice
                                  ? () => toggleSacrifice(card.id)
                                  : needsHandDiscard
                                    ? () =>
                                        sendCommand({
                                          type: 'DiscardHandCard',
                                          playerId: p.id,
                                          cardId: card.id
                                        })
                                    : undefined
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Compact Veil & Days Footer */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="zone-slot" style={{ minHeight: 62 }}>
                <div className="zone-label">
                  <span>The Veil (Public Discard)</span>
                  <span>{view.veil.length} cards</span>
                </div>
                <div className="brand-sub mono">
                  {view.veil.length === 0 ? 'Empty' : view.veil.map((c) => c.shortLabel).join(' · ')}
                </div>
              </div>

              <div className="zone-slot" style={{ minHeight: 62 }}>
                <div className="zone-label">
                  <span>Deck of Days</span>
                  <span>{view.daysCount} remaining</span>
                </div>
                <div className="brand-sub mono">
                  {view.daysCards === null
                    ? 'Hidden draw order (switch to Admin God Mode to inspect)'
                    : `Next → ${view.daysCards.slice(0, 12).map((c) => c.shortLabel).join(' · ')}${view.daysCards.length > 12 ? ' …' : ''}`}
                </div>
              </div>
            </div>
          </section>

          {/* Collapsible Dev Inspector & Timeline Drawer */}
          {inspectorOpen && (
            <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Timeline &amp; Playback</h2>
                  <span className={`badge ${invariantReport.ok ? 'badge-ok' : 'badge-danger'}`}>
                    {invariantReport.ok ? 'Invariants OK' : 'Invariant Error'}
                  </span>
                </div>

                <div className="timeline-bar">
                  <button
                    className="btn btn-sm"
                    disabled={currentStepIndex <= 0}
                    onClick={() => {
                      setAutoPlayMode('off');
                      setTimelineStep(0);
                    }}
                  >
                    ⏮
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={currentStepIndex <= 0}
                    onClick={() => {
                      setAutoPlayMode('off');
                      setTimelineStep(Math.max(0, currentStepIndex - 1));
                    }}
                  >
                    ◀
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={maxStepIndex}
                    value={currentStepIndex}
                    onChange={(e) => {
                      setAutoPlayMode('off');
                      const val = Number(e.target.value);
                      setTimelineStep(val === maxStepIndex ? null : val);
                    }}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={!isViewingHistory}
                    onClick={() => {
                      setAutoPlayMode('off');
                      const next = currentStepIndex + 1;
                      setTimelineStep(next >= maxStepIndex ? null : next);
                    }}
                  >
                    ▶
                  </button>
                  <button
                    className={`btn btn-sm ${timelineStep === null ? 'btn-active' : ''}`}
                    onClick={() => {
                      setAutoPlayMode('off');
                      setTimelineStep(null);
                    }}
                  >
                    Live
                  </button>
                </div>

                <div className="toolbar-group">
                  <select
                    className="select"
                    style={{ fontSize: 12 }}
                    value={readerBotPolicy}
                    onChange={(e) => setReaderBotPolicy(e.target.value as AgentPolicyId)}
                  >
                    <option value="bluffing-rival">Bot: Bluffing Rival</option>
                    <option value="evolution-greedy">Bot: Honest Coach</option>
                  </select>
                  <select
                    className="select"
                    style={{ fontSize: 12 }}
                    value={autoPlayMs}
                    onChange={(e) => setAutoPlayMs(Number(e.target.value))}
                  >
                    <option value={350}>Fast</option>
                    <option value={850}>Normal</option>
                    <option value={1400}>Slow</option>
                  </select>
                  <span className="mono" style={{ fontSize: 11 }}>
                    Step {currentStepIndex}/{maxStepIndex} · #{view.stateHash.slice(0, 8)}
                  </span>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">
                    Event Log ({viewer.role === 'admin' ? 'Admin' : viewer.playerId.toUpperCase()})
                  </h2>
                  <span className="badge">{view.events.length}</span>
                </div>

                <div className="toolbar-group">
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      void copyText(formatEventsAsText(view), 'Copied Event Log (TXT) to clipboard.')
                    }
                  >
                    Copy Log
                  </button>
                  <button className="btn btn-sm" onClick={handleExportTxt}>
                    Export TXT
                  </button>
                  <button className="btn btn-sm" onClick={() => handleExportJson(viewer)}>
                    Export JSON
                  </button>
                  <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>
                    Import Replay
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json"
                    style={{ display: 'none' }}
                    onChange={handleImportFile}
                  />
                </div>

                <div className="log-list">
                  {[...view.events].reverse().map((ev) => {
                    const isHighlight =
                      ev.type === 'LineageEvolved' ||
                      ev.type === 'ReaderRewardGranted' ||
                      ev.type === 'BarrierReconciled' ||
                      ev.type === 'TrialPassed' ||
                      ev.type === 'TreasureClaimed';
                    const isRej = ev.type === 'CommandRejected';
                    return (
                      <div
                        key={ev.seq}
                        className={`log-item ${isHighlight ? 'evo' : ''} ${isRej ? 'reject' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                          <strong>
                            #{ev.seq} {ev.type}
                          </strong>
                          <span className="mono">
                            R{ev.round}·T{ev.turn}
                          </span>
                        </div>
                        <div>{ev.summary}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: DECK COMPONENTS                                                */}
      {/* ===================================================================== */}
      {tab === 'deck' && (
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              Active Deck Components · {view.deckComponents.length} Cards ({view.ruleset.name})
            </h2>
            <span className="badge badge-ok">
              View: {viewer.role === 'admin' ? 'Admin (Exact Zones)' : `${viewer.playerId.toUpperCase()} (Visibility-Safe)`}
            </span>
          </div>

          <div className="metrics-grid">
            <div className="metric-box">
              <div className="metric-label">Total Cards</div>
              <div className="metric-value">{view.deckComponents.length}</div>
              <div className="brand-sub">
                4 suits × Ranks A–{view.ruleset.maxMinorRank} (No 10s, No Courts in Milestone C)
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
              <div className="metric-label">Evolution Colors</div>
              <div className="metric-value">Black / Red</div>
              <div className="brand-sub">Black: Air ♠ + Fire ♣ · Red: Water ♥ + Earth ♦</div>
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
                    Beats {ELEMENT_META[meta.beats].label} · Vulnerable to {ELEMENT_META[meta.vulnerableTo].label}
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
      )}

      {/* ===================================================================== */}
      {/* TAB 3: RULES & INSPECTOR                                              */}
      {/* ===================================================================== */}
      {tab === 'rules' && (
        <div className="stage-with-drawer">
          <section className="panel">
            <div className="panel-header">
              <h2 className="panel-title">Milestone C Configurable Ruleset Parameters</h2>
              <span className="badge">v{ruleset.version}</span>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Evolution Color Policy</label>
                <select
                  className="select"
                  value={draftColors}
                  onChange={(e) => setDraftColors(e.target.value as EvolutionColorPolicy)}
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
                  value={draftJump}
                  onChange={(e) => setDraftJump(Number(e.target.value))}
                >
                  <option value={1}>+1 only (Hard)</option>
                  <option value={2}>+1 or +2 (Basic)</option>
                </select>
              </div>

              <div className="field">
                <label>Evolution Tie-Breaker (Provisional)</label>
                <select
                  className="select"
                  value={draftTieBreak}
                  onChange={(e) => setDraftTieBreak(e.target.value as EvolutionTieBreakPolicy)}
                >
                  <option value="lowest-rank-same-element">Lowest Rank → Same Element</option>
                  <option value="lowest-rank-first">Lowest Rank → Card ID</option>
                  <option value="highest-jump-first">Highest Jump First</option>
                </select>
              </div>

              <div className="field">
                <label>GOOD → Pursue → Abandon Reader Bonus</label>
                <select
                  className="select"
                  value={draftReaderBonusOnAbandon ? 'yes' : 'no'}
                  onChange={(e) => setDraftReaderBonusOnAbandon(e.target.value === 'yes')}
                >
                  <option value="no">No — Requires Claim (Creator Ruling)</option>
                  <option value="yes">Yes — Award on Pursue (Test Toggle)</option>
                </select>
              </div>

              <div className="field">
                <label>Trial Elemental Target (Provisional)</label>
                <select
                  className="select"
                  value={draftTrialTarget}
                  onChange={(e) => setDraftTrialTarget(e.target.value as 'event' | 'center')}
                >
                  <option value="event">Left Event Element (Default)</option>
                  <option value="center">Center Card Element (Experiment)</option>
                </select>
              </div>

              <div className="field">
                <label>Trial Advantage Bonus VP (Provisional)</label>
                <select
                  className="select"
                  value={draftTrialBonusVP}
                  onChange={(e) => setDraftTrialBonusVP(Number(e.target.value))}
                >
                  <option value={1}>+1 VP once (Default)</option>
                  <option value={0}>0 VP (Gate only — must sacrifice)</option>
                </select>
              </div>

              <div className="field">
                <label>Optional Lineage Reading Hints</label>
                <select
                  className="select"
                  value={draftHintsEnabled ? 'on' : 'off'}
                  onChange={(e) => setDraftHintsEnabled(e.target.value === 'on')}
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
                    value={draftStartHand}
                    onChange={(e) => setDraftStartHand(Number(e.target.value))}
                  />
                  <span>/</span>
                  <input
                    className="input"
                    style={{ width: 70 }}
                    type="number"
                    min={2}
                    max={8}
                    value={draftMaxHand}
                    onChange={(e) => setDraftMaxHand(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            <div className="toolbar-group">
              <button className="btn btn-primary" onClick={applyCustomRuleset}>
                Apply Custom Rules &amp; Start Seeded Game
              </button>
            </div>

            <div className="panel-header" style={{ marginTop: 8 }}>
              <h2 className="panel-title">Executive Blueprint v0.2 — Confidence Registry</h2>
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
                    <td><strong>{a.label}</strong></td>
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
              commands: {inspectedState.commandHistory.length} accepted / {inspectedState.rejectedCommands.length} rejected
              <br />
              invariantsOk: {String(invariantReport.ok)}
            </div>
          </aside>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: SIMULATION LAB                                                 */}
      {/* ===================================================================== */}
      {tab === 'lab' && (
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">
              Deterministic Batch Simulation Lab · {ruleset.id} (v{ruleset.version})
            </h2>
            <div className="toolbar-group">
              {simSummary && (
                <>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      void copyText(
                        formatBatchAsText(simSummary),
                        'Copied Simulation Summary (TXT) to clipboard.'
                      )
                    }
                  >
                    Copy Summary
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      downloadBlob(
                        `nce-batch-${simSummary.rulesetId}-${simSummary.seedPrefix}.csv`,
                        formatBatchAsCsv(simSummary),
                        'text/csv'
                      )
                    }
                  >
                    Export CSV
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      downloadBlob(
                        `nce-batch-${simSummary.rulesetId}-${simSummary.seedPrefix}.json`,
                        JSON.stringify(simSummary, null, 2),
                        'application/json'
                      )
                    }
                  >
                    Export JSON
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="toolbar-group">
            <select
              className="select"
              value={simPolicy}
              onChange={(e) => setSimPolicy(e.target.value as AgentPolicyId)}
            >
              <option value="bluffing-rival">Policy: bluffing-rival</option>
              <option value="evolution-greedy">Policy: evolution-greedy</option>
              <option value="always-claim">Policy: always-claim</option>
            </select>

            <input
              className="input mono"
              value={simSeedPrefix}
              onChange={(e) => setSimSeedPrefix(e.target.value)}
              placeholder="seed-prefix"
            />

            {[10, 50, 100, 500].map((n) => (
              <button
                key={n}
                className={`btn ${simRuns === n && simSummary ? 'btn-active' : 'btn-primary'}`}
                onClick={() => runLabBatch(n)}
              >
                Run {n} Games
              </button>
            ))}
          </div>

          {simSummary && (
            <>
              <div className="metrics-grid">
                <div className="metric-box">
                  <div className="metric-label">Avg Turns</div>
                  <div className="metric-value">{simSummary.avgTurns}</div>
                  <div className="brand-sub">range {simSummary.minTurns}–{simSummary.maxTurns}</div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">Evolution Reach</div>
                  <div className="metric-value">Rank {simSummary.avgHighestRank}</div>
                  <div className="brand-sub">
                    7+: {simSummary.pctReachingRank7Plus}% · 9: {simSummary.pctReachingRank9}%
                  </div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">Realities Resolved</div>
                  <div className="metric-value">
                    {simSummary.totalTreasures}T / {simSummary.totalBarriersPassed}B / {simSummary.totalTrialsPassed}Tr
                  </div>
                  <div className="brand-sub">
                    Abandoned: {simSummary.totalAbandoned} (claimed free: {simSummary.totalAbandonedClaimedFree})
                  </div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">Readings &amp; Rewards</div>
                  <div className="metric-value">{simSummary.adviceFollowPct}% followed</div>
                  <div className="brand-sub">
                    Bluffs: {simSummary.deceptionPct}% · Withheld on abandon: {simSummary.totalWithheldOnAbandon}
                  </div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">Integrity Gates</div>
                  <div className="metric-value">
                    {simSummary.invariantFailures === 0 && simSummary.replayFailures === 0 ? 'PASS' : 'FAIL'}
                  </div>
                  <div className="brand-sub">{simSummary.durationMs} ms · 0 inv / 0 replay errs</div>
                </div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>Seed</th>
                    <th>Turns</th>
                    <th>Top Rank</th>
                    <th>T / B / Tr</th>
                    <th>Abandoned</th>
                    <th>Readings (Bluffs)</th>
                    <th>Final Hash</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {simSummary.sampleRuns.map((r) => (
                    <tr key={r.seed}>
                      <td className="mono">{r.seed}</td>
                      <td>{r.turns}</td>
                      <td>{r.highestRank}</td>
                      <td>
                        {r.treasuresClaimed} / {r.barriersReconciled} / {r.trialsPassed}
                      </td>
                      <td>
                        {r.centersAbandoned} ({r.abandonedClaimedFree} free)
                      </td>
                      <td>
                        {r.readingsGiven} ({r.deceptiveReadings})
                      </td>
                      <td className="mono">{r.finalStateHash}</td>
                      <td>
                        <div className="toolbar-group">
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              startNewGame(ruleset, r.seed, r.commands, {
                                startAtStepZero: true,
                                autoPlayReplay: true
                              });
                              setTab('play');
                            }}
                          >
                            ▶ Watch Turn by Turn
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              startNewGame(ruleset, r.seed, r.commands, { startAtStepZero: false });
                              setTab('play');
                            }}
                          >
                            End State
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
