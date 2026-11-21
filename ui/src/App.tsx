import { useEffect, useRef, useState } from "preact/hooks";
import { fetchSessions, fetchSessionTurns, subscribeEvents, type SessionSummary, type TurnRecord } from "./api.js";
import { DiffInspector } from "./DiffInspector.js";

function formatUsd(n: number): string {
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

export function App() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<number | null>(null);

  const loadAll = async (preserveSelection = true) => {
    try {
      const list = await fetchSessions();
      setSessions(list);
      const currentActive = activeSessionIdRef.current;
      const targetId =
        preserveSelection && currentActive && list.some((s) => s.id === currentActive)
          ? currentActive
          : list[0]?.id ?? null;

      activeSessionIdRef.current = targetId;
      setActiveSessionId(targetId);
      if (!targetId) {
        setTurns([]);
        return;
      }
      const tList = await fetchSessionTurns(targetId);
      setTurns(tList);
      setSelectedTurnId((prev) => {
        if (preserveSelection && prev && tList.some((t) => t.id === prev)) return prev;
        // Auto-focus the worst cache break turn for instant 5-second clarity
        const worstBreak = [...tList]
          .filter((t) => t.diagnosis.kind !== "NONE" && t.diagnosis.kind !== "FIRST_TURN")
          .sort((a, b) => b.diagnosis.wastedUsd - a.diagnosis.wastedUsd)[0];
        return worstBreak?.id ?? tList[tList.length - 1]?.id ?? null;
      });
    } catch {
      // ignore transient polling/network errors
    }
  };

  useEffect(() => {
    void loadAll(false);
    return subscribeEvents(() => {
      void loadAll(true);
    });
  }, []);

  const selectSession = async (id: string) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    try {
      const tList = await fetchSessionTurns(id);
      setTurns(tList);
      const worstBreak = [...tList]
        .filter((t) => t.diagnosis.kind !== "NONE" && t.diagnosis.kind !== "FIRST_TURN")
        .sort((a, b) => b.diagnosis.wastedUsd - a.diagnosis.wastedUsd)[0];
      setSelectedTurnId(worstBreak?.id ?? tList[tList.length - 1]?.id ?? null);
    } catch {
      // ignore transient errors
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const selectedTurn = turns.find((t) => t.id === selectedTurnId) ?? null;
  const maxPrompt = Math.max(1, ...turns.map((t) => t.usage.totalPromptTokens));

  return (
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-dot" />
          <h1>kvdiff</h1>
          <span class="subtitle">Prompt-Cache Byte Diff &amp; Prefix Healer</span>
        </div>
        <div class="session-picker">
          <label for="sess">Session:</label>
          <select
            id="sess"
            value={activeSessionId ?? ""}
            onChange={(e) => void selectSession((e.target as HTMLSelectElement).value)}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.turnCount} turns)
              </option>
            ))}
          </select>
        </div>
      </header>

      {activeSession && (
        <section class="kpis">
          <div class="kpi-card">
            <div class="kpi-label">Avg Cache Hit</div>
            <div class={`kpi-value ${activeSession.avgCacheHitRate >= 0.8 ? "text-green" : "text-amber"}`}>
              {Math.round(activeSession.avgCacheHitRate * 100)}%
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Cache Breaks</div>
            <div class={`kpi-value ${activeSession.breakCount > 0 ? "text-red" : "text-green"}`}>
              {activeSession.breakCount}
            </div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total Session Spend</div>
            <div class="kpi-value">{formatUsd(activeSession.totalCostUsd)}</div>
          </div>
          <div class="kpi-card kpi-danger">
            <div class="kpi-label">Wasted on Cache Misses</div>
            <div class="kpi-value text-red">
              {activeSession.totalWastedUsd > 0 ? `-${formatUsd(activeSession.totalWastedUsd)}` : "$0.00"}
            </div>
          </div>
        </section>
      )}

      <main class="workspace">
        <section class="waterfall-panel">
          <div class="panel-header">
            <h2>Turn Waterfall</h2>
            <div class="legend">
              <span><i class="swatch sw-green" /> Cache Read</span>
              <span><i class="swatch sw-amber" /> Cache Write</span>
              <span><i class="swatch sw-red" /> Uncached Input</span>
            </div>
          </div>
          <div class="waterfall-list">
            {turns.length === 0 ? (
              <div class="empty-state">
                Waiting for LLM API traffic on this proxy… Run <code>kvdiff -- claude</code> or <code>kvdiff --demo</code>.
              </div>
            ) : (
              turns.map((t) => {
                const isBreak = t.diagnosis.kind !== "NONE" && t.diagnosis.kind !== "FIRST_TURN";
                const total = Math.max(1, t.usage.totalPromptTokens);
                const scale = (total / maxPrompt) * 100;
                const readPct = (t.usage.cacheReadTokens / total) * scale;
                const writePct = (t.usage.cacheWriteTokens / total) * scale;
                const uncachedPct = (t.usage.inputTokens / total) * scale;
                const selected = t.id === selectedTurnId;

                return (
                  <button
                    key={t.id}
                    type="button"
                    class={`turn-row ${selected ? "selected" : ""} ${isBreak ? "row-break" : ""}`}
                    onClick={() => setSelectedTurnId(t.id)}
                  >
                    <span class="col-turn">#{t.turnIndex}</span>
                    <span class="col-bar">
                      <span class="bar-track">
                        <span class="bar-seg seg-green" style={{ width: `${readPct}%` }} />
                        <span class="bar-seg seg-amber" style={{ width: `${writePct}%` }} />
                        <span class="bar-seg seg-red" style={{ width: `${uncachedPct}%` }} />
                      </span>
                    </span>
                    <span class={`col-hit ${isBreak ? "text-red" : "text-green"}`}>
                      {Math.round(t.diagnosis.cacheHitRate * 100)}%
                    </span>
                    <span class="col-status">
                      {t.healed ? (
                        <span class="pill pill-cyan">HEALED</span>
                      ) : isBreak ? (
                        <span class="pill pill-red">{t.diagnosis.kind}</span>
                      ) : (
                        <span class="pill pill-muted">{t.diagnosis.kind === "FIRST_TURN" ? "WARM" : "HIT"}</span>
                      )}
                    </span>
                    <span class="col-waste">
                      {t.diagnosis.wastedUsd > 0 ? `-${formatUsd(t.diagnosis.wastedUsd)}` : `${t.latencyMs}ms`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section class="inspector-panel">
          <DiffInspector turn={selectedTurn} />
        </section>
      </main>
    </div>
  );
}
