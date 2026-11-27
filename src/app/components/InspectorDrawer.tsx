import React from 'react';
import {
  formatEventsAsText,
  type InvariantReport,
  type ProjectedGameView,
  type Viewer
} from '../../engine/index.js';
import type { AgentPolicyId } from '../../sim/agents.js';

export function InspectorDrawer({
  view,
  viewer,
  invariantReport,
  currentStepIndex,
  maxStepIndex,
  isViewingHistory,
  timelineStep,
  readerBotPolicy,
  autoPlayMs,
  fileInputRef,
  onSetTimelineStep,
  onStopAutoPlay,
  onSetReaderBotPolicy,
  onSetAutoPlayMs,
  onCopyText,
  onExportTxt,
  onExportJson,
  onImportFile
}: {
  view: ProjectedGameView;
  viewer: Viewer;
  invariantReport: InvariantReport;
  currentStepIndex: number;
  maxStepIndex: number;
  isViewingHistory: boolean;
  timelineStep: number | null;
  readerBotPolicy: AgentPolicyId;
  autoPlayMs: number;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onSetTimelineStep: (step: number | null) => void;
  onStopAutoPlay: () => void;
  onSetReaderBotPolicy: (policy: AgentPolicyId) => void;
  onSetAutoPlayMs: (ms: number) => void;
  onCopyText: (text: string, label: string) => void;
  onExportTxt: () => void;
  onExportJson: (exportViewer: Viewer) => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
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
              onStopAutoPlay();
              onSetTimelineStep(0);
            }}
          >
            ⏮
          </button>
          <button
            className="btn btn-sm"
            disabled={currentStepIndex <= 0}
            onClick={() => {
              onStopAutoPlay();
              onSetTimelineStep(Math.max(0, currentStepIndex - 1));
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
              onStopAutoPlay();
              const val = Number(e.target.value);
              onSetTimelineStep(val === maxStepIndex ? null : val);
            }}
          />
          <button
            className="btn btn-sm"
            disabled={!isViewingHistory}
            onClick={() => {
              onStopAutoPlay();
              const next = currentStepIndex + 1;
              onSetTimelineStep(next >= maxStepIndex ? null : next);
            }}
          >
            ▶
          </button>
          <button
            className={`btn btn-sm ${timelineStep === null ? 'btn-active' : ''}`}
            onClick={() => {
              onStopAutoPlay();
              onSetTimelineStep(null);
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
            onChange={(e) => onSetReaderBotPolicy(e.target.value as AgentPolicyId)}
          >
            <option value="bluffing-rival">Bot: Bluffing Rival</option>
            <option value="evolution-greedy">Bot: Honest Coach</option>
          </select>
          <select
            className="select"
            style={{ fontSize: 12 }}
            value={autoPlayMs}
            onChange={(e) => onSetAutoPlayMs(Number(e.target.value))}
          >
            <option value={350}>Fast</option>
            <option value={850}>Normal</option>
            <option value={1400}>Slow</option>
          </select>
          <span className="mono" style={{ fontSize: 11 }}>
            Step {currentStepIndex}/{maxStepIndex} · #{view.stateHash.slice(0, 8)}
            {view.seed ? ` · ${view.seed}` : ' · seed hidden'}
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
              onCopyText(formatEventsAsText(view), 'Copied Event Log (TXT) to clipboard.')
            }
          >
            Copy Log
          </button>
          <button className="btn btn-sm" onClick={onExportTxt}>
            Export TXT
          </button>
          <button className="btn btn-sm" onClick={() => onExportJson(viewer)}>
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
            onChange={onImportFile}
          />
        </div>

        <div className="log-list">
          {[...view.events].reverse().map((ev) => {
            const isHighlight =
              ev.type === 'LineageEvolved' ||
              ev.type === 'ReaderRewardGranted' ||
              ev.type === 'ReaderBonusConsumed' ||
              ev.type === 'ElementalEffectResolved' ||
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
  );
}
