import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExportBundle,
  checkInvariants,
  cloneRulesetWithOverrides,
  createGame,
  dispatch,
  evaluateReconciliation,
  formatEventsAsText,
  projectView,
  replay,
  RULESET_PRESETS,
  type BoardTargetSlot,
  type Card,
  type Command,
  type ExportBundle,
  type GameState,
  type PlayerState,
  type Ruleset,
  type Viewer
} from '../engine/index.js';
import type { AgentPolicyId } from '../sim/agents.js';
import {
  advanceAutomatedStepsUntilHumanTurn,
  getAutomatedActorId,
  runOneAutomatedStep,
  type HumanVsBotConfig,
  type PlayControlMode
} from '../sim/botController.js';
import { runSimulationBatch, type BatchSimulationSummary } from '../sim/runner.js';
import { DeckView } from './components/DeckView.js';
import { GameTable } from './components/GameTable.js';
import { InspectorDrawer } from './components/InspectorDrawer.js';
import { RulesView, type RulesDraftState } from './components/RulesView.js';
import { SimulationLabView } from './components/SimulationLabView.js';
import {
  getElementalTargetContext,
  INITIAL_ELEMENTAL_SELECTION,
  selectBonusForElemental,
  selectHandCardForElemental,
  toggleBoardSlotSelection,
  toggleDaysZoneSelection,
  toggleVeilTargetSelection,
  type ElementalSelectionState
} from './elementalTargeting.js';
import { loadActiveSession, saveActiveSession } from './storage.js';

type ActiveTab = 'play' | 'deck' | 'rules' | 'lab';

const DEFAULT_PRESET_ID = 'poker-proto-d1';
const DEFAULT_SEED = 'eclipse-d1-001';
const HUMAN_PLAYER_ID = 'p1';

function rulesetToDraft(r: Ruleset): RulesDraftState {
  return {
    colors: r.allowedEvolutionColors,
    jump: r.maxEvolutionJump,
    tieBreak: r.evolutionTieBreak,
    startHand: r.startingHandSize,
    maxHand: r.maxHandSize,
    readerBonusOnAbandon: r.readerBonusOnAbandon,
    readerBonusPolicy: r.readerBonusPolicy,
    readerBonusConsumesTurnAction: r.readerBonusConsumesTurnAction,
    rotateEventOnCenterDiscard: r.rotateEventOnCenterDiscard,
    waterResurfaceDestination: r.waterResurfaceDestination,
    elementalNativePrimaryBonusVP: r.elementalNativePrimaryBonusVP,
    trialTarget: r.trialTargetElement,
    trialBonusVP: r.trialAdvantageBonusVP,
    hintsEnabled: r.readingTierHintsEnabled
  };
}

function createInitialPlayState(
  ruleset: Ruleset,
  seed: string,
  config: HumanVsBotConfig
): { state: GameState; initialBotNote: string | null } {
  const fresh = createGame(ruleset, seed);
  if (config.mode !== 'human-vs-bot') {
    return { state: fresh, initialBotNote: null };
  }
  // In Human vs Bot, Bot (p2) automatically delivers Turn 1's opening reading so Player 1 can play immediately!
  const advanced = advanceAutomatedStepsUntilHumanTurn(fresh, config, 8);
  const lastEvent = advanced.state.events[advanced.state.events.length - 1];
  return {
    state: advanced.state,
    initialBotNote: advanced.executed.length > 0 && lastEvent ? lastEvent.summary : null
  };
}

export function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [tab, setTab] = useState<ActiveTab>('play');
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);

  // D1.2 Default: Human (p1) vs Autonomous Bot (p2)
  const [controlMode, setControlMode] = useState<PlayControlMode>('human-vs-bot');
  const [fastTestAutoHumanReading, setFastTestAutoHumanReading] = useState<boolean>(false);
  const [botPolicy, setBotPolicy] = useState<AgentPolicyId>('bluffing-rival');
  const [autoPlayMs, setAutoPlayMs] = useState<number>(600);
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false);

  const [ruleset, setRuleset] = useState<Ruleset>(RULESET_PRESETS[DEFAULT_PRESET_ID]!);
  const [seed, setSeed] = useState<string>(DEFAULT_SEED);

  const initialBoot = useMemo(
    () =>
      createInitialPlayState(RULESET_PRESETS[DEFAULT_PRESET_ID]!, DEFAULT_SEED, {
        mode: 'human-vs-bot',
        humanPlayerId: HUMAN_PLAYER_ID,
        botPolicy: 'bluffing-rival',
        fastTestAutoHumanReading: false
      }),
    []
  );

  const [liveState, setLiveState] = useState<GameState>(initialBoot.state);
  const [lastBotSummary, setLastBotSummary] = useState<string | null>(initialBoot.initialBotNote);
  const [viewer, setViewer] = useState<Viewer>({ role: 'player', playerId: HUMAN_PLAYER_ID });
  const [timelineStep, setTimelineStep] = useState<number | null>(null);

  // Direct card-to-zone interaction state
  const [selectedSacrificeIds, setSelectedSacrificeIds] = useState<string[]>([]);
  const [elementalSelection, setElementalSelection] = useState<ElementalSelectionState>(
    INITIAL_ELEMENTAL_SELECTION
  );
  const [veilTrayOpen, setVeilTrayOpen] = useState<boolean>(false);

  const [storageKind, setStorageKind] = useState<string>('local');
  const [notice, setNotice] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const [rulesDraft, setRulesDraft] = useState<RulesDraftState>(() =>
    rulesetToDraft(RULESET_PRESETS[DEFAULT_PRESET_ID]!)
  );
  const [draftSeedInput, setDraftSeedInput] = useState<string>(DEFAULT_SEED);

  // Batch simulation lab state
  const [simRuns, setSimRuns] = useState<number>(500);
  const [simPolicy, setSimPolicy] = useState<AgentPolicyId>('bluffing-rival');
  const [simSeedPrefix, setSimSeedPrefix] = useState<string>('lab-md1');
  const [simSummary, setSimSummary] = useState<BatchSimulationSummary | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydratedRef = useRef(false);

  const hvbConfig: HumanVsBotConfig = useMemo(
    () => ({
      mode: controlMode,
      humanPlayerId: HUMAN_PLAYER_ID,
      botPolicy,
      fastTestAutoHumanReading
    }),
    [controlMode, botPolicy, fastTestAutoHumanReading]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void loadActiveSession().then((saved) => {
      if (cancelled) return;
      hydratedRef.current = true;
      if (!saved || saved.ruleset.version !== '1.4.0' || saved.commands.length === 0) return;
      const rep = replay(saved.seed, saved.ruleset, saved.commands);
      if (rep.ok) {
        setRuleset(saved.ruleset);
        setSeed(saved.seed);
        setDraftSeedInput(saved.seed);
        setRulesDraft(rulesetToDraft(saved.ruleset));
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

  useEffect(() => {
    setSelectedSacrificeIds([]);
    setElementalSelection(INITIAL_ELEMENTAL_SELECTION);
  }, [liveState.phase, liveState.turn, liveState.activePlayerId]);

  const timelineSnapshots = useMemo(() => {
    const cmds = liveState.commandHistory.map((r) => r.command);
    return replay(liveState.seed, liveState.ruleset, cmds).snapshots;
  }, [liveState]);

  const isViewingHistory =
    timelineStep !== null && timelineStep < timelineSnapshots.length - 1;

  // Replay playback timer (strictly separate from Bot player automation!)
  useEffect(() => {
    if (!replayPlaying) return;
    const timer = window.setInterval(() => {
      setTimelineStep((prev) => {
        const next = (prev ?? 0) + 1;
        if (next >= timelineSnapshots.length - 1) {
          setReplayPlaying(false);
          return null;
        }
        return next;
      });
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [replayPlaying, autoPlayMs, timelineSnapshots.length]);

  // Autonomous Fair Bot Loop (in `human-vs-bot` ONLY controls Bot — NEVER Human's turn!)
  const pendingAutoActorId = useMemo(() => {
    if (isViewingHistory || replayPlaying || tab !== 'play') return null;
    return getAutomatedActorId(liveState, hvbConfig);
  }, [liveState, hvbConfig, isViewingHistory, replayPlaying, tab]);

  useEffect(() => {
    if (!pendingAutoActorId) return;
    const delayMs =
      controlMode === 'auto-sim'
        ? Math.min(autoPlayMs, 420)
        : fastTestAutoHumanReading
          ? 180
          : 520;

    const timer = window.setTimeout(() => {
      setLiveState((prev) => {
        const step = runOneAutomatedStep(prev, hvbConfig);
        if (!step) return prev;
        const latestPublic = [...step.state.events]
          .reverse()
          .find((e) => e.visibility === 'public' && e.type !== 'TurnStarted');
        if (latestPublic) {
          setLastBotSummary(latestPublic.summary);
        }
        return step.state;
      });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [pendingAutoActorId, hvbConfig, controlMode, fastTestAutoHumanReading, autoPlayMs, liveState.commandHistory.length]);

  const inspectedState: GameState = useMemo(() => {
    if (timelineStep === null) return liveState;
    const clamped = Math.max(0, Math.min(timelineStep, timelineSnapshots.length - 1));
    return timelineSnapshots[clamped]?.state ?? liveState;
  }, [liveState, timelineSnapshots, timelineStep]);

  const view = useMemo(() => projectView(inspectedState, viewer), [inspectedState, viewer]);
  const invariantReport = useMemo(() => checkInvariants(inspectedState), [inspectedState]);
  const activePlayer = view.players.find((p) => p.id === view.activePlayerId)!;

  const isBotActing = Boolean(pendingAutoActorId);

  const canActAsActivePlayer =
    !isViewingHistory &&
    !isBotActing &&
    view.status === 'playing' &&
    (viewer.role === 'admin' || viewer.playerId === view.activePlayerId) &&
    (controlMode !== 'human-vs-bot' || view.activePlayerId === HUMAN_PLAYER_ID);

  const canActAsReader =
    !isViewingHistory &&
    !isBotActing &&
    view.status === 'playing' &&
    view.phase === 'AWAITING_READING' &&
    view.currentReading !== null &&
    (viewer.role === 'admin' || viewer.playerId === view.currentReading.readerId) &&
    (controlMode !== 'human-vs-bot' || view.currentReading.readerId === HUMAN_PLAYER_ID);

  const elementalCtx = useMemo(
    () => getElementalTargetContext(view, activePlayer, elementalSelection),
    [view, activePlayer, elementalSelection]
  );

  // Live Barrier/Trial reconciliation calculator (visibility-safe)
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
      effectUsedThisTurn: activePlayer.effectUsedThisTurn,
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
    options: {
      startAtStepZero?: boolean;
      autoPlayReplay?: boolean;
      nextMode?: PlayControlMode;
    } = {}
  ) {
    const modeToUse = options.nextMode ?? controlMode;
    setReplayPlaying(false);
    setSelectedSacrificeIds([]);
    setElementalSelection(INITIAL_ELEMENTAL_SELECTION);
    setVeilTrayOpen(false);

    if (initialCommands.length > 0) {
      const rep = replay(nextSeed, nextRuleset, initialCommands);
      if (!rep.ok) {
        setNotice(`Failed to initialize seed "${nextSeed}": ${rep.error?.message ?? 'unknown error'}`);
        return;
      }
      setRuleset(nextRuleset);
      setSeed(nextSeed);
      setDraftSeedInput(nextSeed);
      setRulesDraft(rulesetToDraft(nextRuleset));
      setLiveState(rep.finalState);
      setLastBotSummary(null);
      if (options.startAtStepZero) {
        setTimelineStep(0);
        setInspectorOpen(true);
        if (options.autoPlayReplay) setReplayPlaying(true);
      } else {
        setTimelineStep(null);
      }
      setNotice(null);
      return;
    }

    const boot = createInitialPlayState(nextRuleset, nextSeed, {
      mode: modeToUse,
      humanPlayerId: HUMAN_PLAYER_ID,
      botPolicy,
      fastTestAutoHumanReading
    });
    setRuleset(nextRuleset);
    setSeed(nextSeed);
    setDraftSeedInput(nextSeed);
    setRulesDraft(rulesetToDraft(nextRuleset));
    setLiveState(boot.state);
    setLastBotSummary(boot.initialBotNote);
    if (modeToUse === 'human-vs-bot') {
      setViewer({ role: 'player', playerId: HUMAN_PLAYER_ID });
    }
    setTimelineStep(null);
    setNotice(null);
  }

  function sendCommand(command: Command) {
    setReplayPlaying(false);
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
      if (command.type === 'UseElementalEffect' || command.type === 'UseReaderBonus') {
        setElementalSelection(INITIAL_ELEMENTAL_SELECTION);
      }
    }
  }

  function handleSelectHandCardForElemental(cardId: string) {
    if (
      elementalSelection.sourceKind === 'hand' &&
      elementalSelection.sourceCardId === cardId
    ) {
      setElementalSelection(INITIAL_ELEMENTAL_SELECTION);
      return;
    }
    const next = selectHandCardForElemental(cardId, view, activePlayer);
    setElementalSelection(next);
    const picked = activePlayer.hand?.find((c) => c.id === cardId);
    if (picked?.element === 'water') {
      setVeilTrayOpen(true);
    }
  }

  function handleSelectBonusForElemental(bonusId: string) {
    if (
      elementalSelection.sourceKind === 'bonus' &&
      elementalSelection.bonusId === bonusId
    ) {
      setElementalSelection(INITIAL_ELEMENTAL_SELECTION);
      return;
    }
    const next = selectBonusForElemental(bonusId, view);
    setElementalSelection(next);
    const bonus = activePlayer.pendingReaderBonuses.find((b) => b.id === bonusId);
    if (bonus?.sourceElement === 'water') {
      setVeilTrayOpen(true);
    }
  }

  function handleClickDaysZone() {
    setElementalSelection((prev) => toggleDaysZoneSelection(prev, elementalCtx, view.daysCount));
  }

  function handleClickBoardSlot(slot: BoardTargetSlot) {
    setElementalSelection((prev) => toggleBoardSlotSelection(prev, slot, elementalCtx));
  }

  function handleToggleVeilCard(cardId: string) {
    setElementalSelection((prev) => toggleVeilTargetSelection(prev, cardId, elementalCtx));
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
    const safeSeed = bundle.seed ?? 'player-safe';
    downloadBlob(
      `nce-${safeSeed}-${suffix}.json`,
      JSON.stringify(bundle, null, 2),
      'application/json'
    );
  }

  function handleExportTxt() {
    const text = formatEventsAsText(view);
    const suffix = viewer.role === 'admin' ? 'admin-log' : `player-${viewer.playerId}-log`;
    const safeSeed = view.seed ?? 'player-safe';
    downloadBlob(`nce-${safeSeed}-${suffix}.txt`, text, 'text/plain');
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
        setRulesDraft(rulesetToDraft(parsed.ruleset));
        setLiveState(rep.finalState);
        setTimelineStep(0);
        setInspectorOpen(true);
        setReplayPlaying(false);
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
      allowedEvolutionColors: rulesDraft.colors,
      maxEvolutionJump: rulesDraft.jump,
      evolutionTieBreak: rulesDraft.tieBreak,
      startingHandSize: rulesDraft.startHand,
      maxHandSize: rulesDraft.maxHand,
      readerBonusOnAbandon: rulesDraft.readerBonusOnAbandon,
      readerBonusPolicy: rulesDraft.readerBonusPolicy,
      readerBonusConsumesTurnAction: rulesDraft.readerBonusConsumesTurnAction,
      rotateEventOnCenterDiscard: rulesDraft.rotateEventOnCenterDiscard,
      waterResurfaceDestination: rulesDraft.waterResurfaceDestination,
      elementalNativePrimaryBonusVP: rulesDraft.elementalNativePrimaryBonusVP,
      trialTargetElement: rulesDraft.trialTarget,
      trialAdvantageBonusVP: rulesDraft.trialBonusVP,
      readingTierHintsEnabled: rulesDraft.hintsEnabled
    });
    startNewGame(updated, draftSeedInput.trim() || 'custom-seed');
    setTab('play');
  }

  function runLabBatch(count: number) {
    setSimRuns(count);
    const summary = runSimulationBatch({
      ruleset,
      runs: count,
      seedPrefix: simSeedPrefix.trim() || 'lab-md1',
      policy: simPolicy,
      verifyReplaySample: Math.min(count, 25),
      maxSampleRuns: 30
    });
    setSimSummary(summary);
  }

  const currentStepIndex = timelineStep ?? timelineSnapshots.length - 1;
  const maxStepIndex = Math.max(0, timelineSnapshots.length - 1);
  const prototypePresets = Object.values(RULESET_PRESETS).filter((r) => r.category === 'prototype');
  const tutorialPresets = Object.values(RULESET_PRESETS).filter((r) => r.category === 'tutorial');

  return (
    <div className="app-shell">
      {/* Compact Unified Chrome */}
      <header className="topbar topbar-compact">
        <div className="toolbar-group">
          <div className="tabs">
            <button className={`btn btn-sm ${tab === 'play' ? 'btn-active' : ''}`} onClick={() => setTab('play')}>
              Play Table
            </button>
            <button className={`btn btn-sm ${tab === 'deck' ? 'btn-active' : ''}`} onClick={() => setTab('deck')}>
              Deck ({view.deckComponents.length})
            </button>
            <button className={`btn btn-sm ${tab === 'rules' ? 'btn-active' : ''}`} onClick={() => setTab('rules')}>
              Rules
            </button>
            <button className={`btn btn-sm ${tab === 'lab' ? 'btn-active' : ''}`} onClick={() => setTab('lab')}>
              Simulation Lab
            </button>
          </div>

          <select
            className="select select-compact"
            aria-label="Select game mode or tutorial"
            value={ruleset.id}
            onChange={(e) => {
              const found = RULESET_PRESETS[e.target.value];
              if (found) startNewGame(found, draftSeedInput.trim() || DEFAULT_SEED);
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
            className="input mono input-compact"
            style={{ width: 112 }}
            value={draftSeedInput}
            onChange={(e) => setDraftSeedInput(e.target.value)}
            placeholder="seed"
          />
          <button
            className="btn btn-sm"
            onClick={() => startNewGame(ruleset, draftSeedInput.trim() || DEFAULT_SEED)}
          >
            New Game
          </button>
        </div>

        <div className="toolbar-group">
          {/* Play Control Mode Switcher (Default: Human vs Bot) */}
          <button
            className={`btn btn-sm ${controlMode === 'human-vs-bot' ? 'btn-active' : ''}`}
            onClick={() => {
              setControlMode('human-vs-bot');
              setViewer({ role: 'player', playerId: HUMAN_PLAYER_ID });
            }}
          >
            Human vs Bot
          </button>
          <button
            className={`btn btn-sm ${controlMode === 'hotseat' ? 'btn-active' : ''}`}
            onClick={() => setControlMode('hotseat')}
          >
            Hotseat
          </button>
          <button
            className={`btn btn-sm ${controlMode === 'auto-sim' ? 'btn-active' : ''}`}
            onClick={() => setControlMode('auto-sim')}
          >
            Auto-Sim
          </button>

          {controlMode === 'human-vs-bot' && (
            <button
              className={`btn btn-sm ${fastTestAutoHumanReading ? 'btn-active' : ''}`}
              title="Optional Fast Test: auto-delivers your Reader advice for Bot while still keeping all your own turn decisions manual."
              onClick={() => setFastTestAutoHumanReading((v) => !v)}
            >
              {fastTestAutoHumanReading ? 'Fast Test: On' : 'Fast Test'}
            </button>
          )}

          {controlMode === 'hotseat' &&
            view.players.map((p) => (
              <button
                key={p.id}
                className={`btn btn-sm ${
                  viewer.role === 'player' && viewer.playerId === p.id ? 'btn-active' : ''
                }`}
                onClick={() => setViewer({ role: 'player', playerId: p.id })}
              >
                {p.name}
              </button>
            ))}

          <button
            className={`btn btn-sm ${viewer.role === 'admin' ? 'btn-active' : ''}`}
            title="Toggle Admin God Mode Inspector (does not change player ownership)"
            onClick={() =>
              setViewer((v) =>
                v.role === 'admin' ? { role: 'player', playerId: HUMAN_PLAYER_ID } : { role: 'admin' }
              )
            }
          >
            {viewer.role === 'admin' ? 'Exit Admin' : 'Admin Inspector'}
          </button>

          {tab === 'play' && (
            <button
              className={`btn btn-sm ${inspectorOpen ? 'btn-active' : ''}`}
              onClick={() => setInspectorOpen((o) => !o)}
            >
              {inspectorOpen ? 'Hide Log' : `Log (${view.events.length})`}
            </button>
          )}
          <button
            className="btn btn-sm"
            title={`Storage: ${storageKind}`}
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>

      {notice && <div className="banner-warn">{notice}</div>}
      {copyFeedback && <div className="banner-ok">{copyFeedback}</div>}

      {tab === 'play' && (
        <div className={inspectorOpen ? 'stage-with-drawer' : 'stage-single'}>
          <GameTable
            view={view}
            viewer={viewer}
            controlMode={controlMode}
            humanPlayerId={HUMAN_PLAYER_ID}
            isBotActing={isBotActing}
            lastBotSummary={lastBotSummary}
            activePlayer={activePlayer}
            canActAsActivePlayer={canActAsActivePlayer}
            canActAsReader={canActAsReader}
            isViewingHistory={isViewingHistory}
            currentStepIndex={currentStepIndex}
            maxStepIndex={maxStepIndex}
            liveReconciliation={liveReconciliation}
            selectedSacrificeIds={selectedSacrificeIds}
            elementalSelection={elementalSelection}
            elementalCtx={elementalCtx}
            veilTrayOpen={veilTrayOpen}
            onToggleVeilTray={() => setVeilTrayOpen((open) => !open)}
            onReturnToLive={() => {
              setReplayPlaying(false);
              setTimelineStep(null);
            }}
            onSwitchViewer={setViewer}
            onToggleSacrifice={toggleSacrifice}
            onClearSacrifices={() => setSelectedSacrificeIds([])}
            onSelectHandCardForElemental={handleSelectHandCardForElemental}
            onSelectBonusForElemental={handleSelectBonusForElemental}
            onCancelElemental={() => setElementalSelection(INITIAL_ELEMENTAL_SELECTION)}
            onClickDaysZone={handleClickDaysZone}
            onClickBoardSlot={handleClickBoardSlot}
            onToggleVeilCard={handleToggleVeilCard}
            onUpdateElementalSelection={(patch) =>
              setElementalSelection((prev) => ({ ...prev, ...patch }))
            }
            onSendCommand={sendCommand}
            onPlayAnotherSeed={() => startNewGame(ruleset, `${seed}-next`)}
            onWatchFullReplay={() => {
              setInspectorOpen(true);
              setTimelineStep(0);
              setReplayPlaying(true);
            }}
          />

          {inspectorOpen && (
            <InspectorDrawer
              view={view}
              viewer={viewer}
              invariantReport={invariantReport}
              currentStepIndex={currentStepIndex}
              maxStepIndex={maxStepIndex}
              isViewingHistory={isViewingHistory}
              timelineStep={timelineStep}
              readerBotPolicy={botPolicy}
              autoPlayMs={autoPlayMs}
              fileInputRef={fileInputRef}
              onSetTimelineStep={setTimelineStep}
              onStopAutoPlay={() => setReplayPlaying(false)}
              onSetReaderBotPolicy={setBotPolicy}
              onSetAutoPlayMs={setAutoPlayMs}
              onCopyText={(text, label) => void copyText(text, label)}
              onExportTxt={handleExportTxt}
              onExportJson={handleExportJson}
              onImportFile={handleImportFile}
            />
          )}
        </div>
      )}

      {tab === 'deck' && <DeckView view={view} viewer={viewer} />}

      {tab === 'rules' && (
        <RulesView
          ruleset={ruleset}
          draft={rulesDraft}
          inspectedState={inspectedState}
          invariantReport={invariantReport}
          onChangeDraft={(patch) => setRulesDraft((prev) => ({ ...prev, ...patch }))}
          onApply={applyCustomRuleset}
        />
      )}

      {tab === 'lab' && (
        <SimulationLabView
          ruleset={ruleset}
          simRuns={simRuns}
          simPolicy={simPolicy}
          simSeedPrefix={simSeedPrefix}
          simSummary={simSummary}
          onSetSimPolicy={setSimPolicy}
          onSetSimSeedPrefix={setSimSeedPrefix}
          onRunBatch={runLabBatch}
          onCopyText={(text, label) => void copyText(text, label)}
          onDownloadBlob={downloadBlob}
          onInspectRun={(runSeed, commands, watchTurnByTurn) => {
            startNewGame(ruleset, runSeed, commands, {
              startAtStepZero: watchTurnByTurn,
              autoPlayReplay: watchTurnByTurn
            });
            setTab('play');
          }}
        />
      )}
    </div>
  );
}
