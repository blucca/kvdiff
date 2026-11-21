import type { TokenUsage } from "../types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function extractGeminiModel(urlPath: string): string {
  const cleanPath = urlPath.split("?")[0] || "";
  const match = /\/v1(?:beta)?\/models\/([^/:]+)/i.exec(cleanPath);
  return match?.[1] ?? "gemini-unknown";
}

export function parseGeminiUsage(bodyOrSseEvents: unknown): TokenUsage {
  let totalPrompt = 0;
  let cacheRead = 0;
  let outputTokens = 0;

  const inspectObject = (obj: Record<string, unknown> | null): void => {
    if (!obj) return;
    const meta = asRecord(obj.usageMetadata);
    if (!meta) return;
    const p = num(meta.promptTokenCount);
    const c = num(meta.cachedContentTokenCount);
    const o = num(meta.candidatesTokenCount);
    if (p > 0) totalPrompt = Math.max(totalPrompt, p);
    if (c > 0) cacheRead = Math.max(cacheRead, c);
    if (o > 0) outputTokens = Math.max(outputTokens, o);
  };

  if (Array.isArray(bodyOrSseEvents)) {
    for (const ev of bodyOrSseEvents) {
      inspectObject(asRecord(ev));
    }
  } else {
    inspectObject(asRecord(bodyOrSseEvents));
  }

  const inputTokens = Math.max(0, totalPrompt - cacheRead);
  return {
    inputTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: 0,
    outputTokens,
    totalPromptTokens: totalPrompt,
  };
}
