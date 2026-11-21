import type { TurnRecord } from "../types.js";

export function formatExitSummary(turns: TurnRecord[], uiUrl: string): string {
  const count = turns.length;
  if (count === 0) {
    return [
      "",
      `[kvdiff] Session complete — 0 turns captured.`,
      `[kvdiff] UI: ${uiUrl}`,
    ].join("\n");
  }

  const nonFirst = turns.filter((t) => t.turnIndex > 1);
  const avgHit =
    nonFirst.length > 0
      ? nonFirst.reduce((acc, t) => acc + t.diagnosis.cacheHitRate, 0) / nonFirst.length
      : turns[0].diagnosis.cacheHitRate;
  const totalCost = turns.reduce((acc, t) => acc + t.costUsd, 0);
  const totalWasted = turns.reduce((acc, t) => acc + t.diagnosis.wastedUsd, 0);
  const breaks = turns.filter((t) => t.diagnosis.kind !== "NONE" && t.diagnosis.kind !== "FIRST_TURN");
  const worst = [...breaks].sort((a, b) => b.diagnosis.wastedUsd - a.diagnosis.wastedUsd)[0];

  const lines = [
    "",
    `[kvdiff] Session complete — ${count} turns | Avg Cache Hit: ${Math.round(avgHit * 100)}% | Spend: $${totalCost.toFixed(4)} | Wasted: $${totalWasted.toFixed(2)}`,
  ];

  if (worst) {
    lines.push(
      `[kvdiff] Worst break: Turn #${worst.turnIndex} (${worst.diagnosis.kind}) at ${worst.diagnosis.jsonPath ?? "$"} (byte ${worst.diagnosis.byteOffset ?? 0}) -> -$${worst.diagnosis.wastedUsd.toFixed(2)}`
    );
  }
  lines.push(`[kvdiff] Inspect waterfall: ${uiUrl}`);
  return lines.join("\n");
}
