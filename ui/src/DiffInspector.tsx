import type { TurnRecord } from "./api.js";

interface Props {
  turn: TurnRecord | null;
}

function highlightFirstDiff(a: string, b: string): { prefix: string; changed: string; rest: string } {
  let idx = 0;
  const max = Math.min(a.length, b.length);
  while (idx < max && a[idx] === b[idx]) idx++;
  const prefix = b.slice(0, idx);
  const changed = b.slice(idx, Math.min(b.length, idx + 24));
  const rest = b.slice(Math.min(b.length, idx + 24));
  return { prefix, changed, rest };
}

export function DiffInspector({ turn }: Props) {
  if (!turn) {
    return (
      <div class="inspector empty">
        <p>Select a turn from the waterfall to inspect byte-level prefix divergence.</p>
      </div>
    );
  }

  const d = turn.diagnosis;
  const isBreak = d.kind !== "NONE" && d.kind !== "FIRST_TURN";
  const prevDiff = highlightFirstDiff(d.currSnippet, d.prevSnippet);
  const currDiff = highlightFirstDiff(d.prevSnippet, d.currSnippet);

  return (
    <div class="inspector">
      <div class="inspector-header">
        <div>
          <span class="turn-badge">Turn #{turn.turnIndex}</span>
          <span class={`pill ${isBreak ? "pill-red" : turn.healed ? "pill-cyan" : "pill-green"}`}>
            {turn.healed ? "HEALED" : d.kind}
          </span>
          <span class="meta-chip">{turn.provider}</span>
          <span class="meta-chip">{turn.model}</span>
        </div>
        <div class="inspector-cost">
          <span>Hit: <strong>{Math.round(d.cacheHitRate * 100)}%</strong></span>
          <span>Cost: <strong>${turn.costUsd.toFixed(4)}</strong></span>
          {d.wastedUsd > 0 && (
            <span class="waste-text">Wasted: <strong>-${d.wastedUsd.toFixed(4)}</strong></span>
          )}
        </div>
      </div>

      <p class="diag-summary">{d.summary}</p>

      <div class="locator-bar">
        <div>
          <span class="locator-label">JSONPath</span>
          <code class="locator-value">{d.jsonPath ?? "—"}</code>
        </div>
        <div>
          <span class="locator-label">UTF-8 Byte Offset</span>
          <code class="locator-value">{d.byteOffset !== null ? d.byteOffset.toLocaleString() : "—"}</code>
        </div>
        <div>
          <span class="locator-label">Prompt Tokens</span>
          <code class="locator-value">
            {turn.usage.cacheReadTokens.toLocaleString()} read · {turn.usage.cacheWriteTokens.toLocaleString()} write · {turn.usage.inputTokens.toLocaleString()} uncached
          </code>
        </div>
      </div>

      {turn.healChanges.length > 0 && (
        <div class="heal-banner">
          <strong>--heal applied:</strong> {turn.healChanges.join(" · ")}
        </div>
      )}

      {d.byteOffset !== null && (d.prevSnippet || d.currSnippet) && (
        <div class="snippet-grid">
          <div class="snippet-box">
            <div class="snippet-title">Previous Turn (Turn #{turn.turnIndex - 1})</div>
            <pre class="snippet-code">
              <span class="tok-same">{prevDiff.prefix}</span>
              <span class="tok-del">{prevDiff.changed}</span>
              <span class="tok-rest">{prevDiff.rest}</span>
            </pre>
          </div>
          <div class="snippet-box">
            <div class="snippet-title">Current Turn (Turn #{turn.turnIndex}) — First Divergent Byte</div>
            <pre class="snippet-code">
              <span class="tok-same">{currDiff.prefix}</span>
              <span class="tok-ins">{currDiff.changed}</span>
              <span class="tok-rest">{currDiff.rest}</span>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
