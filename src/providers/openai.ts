import type { TokenUsage } from "../types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function parseOpenAiUsage(bodyOrSseEvents: unknown): TokenUsage {
  let totalPrompt = 0;
  let cacheRead = 0;
  let outputTokens = 0;

  const inspectObject = (obj: Record<string, unknown> | null): void => {
    if (!obj) return;
    const responseObj = asRecord(obj.response);
    const usage = asRecord(obj.usage) ?? asRecord(responseObj?.usage);
    const timings = asRecord(obj.timings);

    if (usage) {
      const prompt = num(usage.prompt_tokens) || num(usage.input_tokens);
      if (prompt > 0) totalPrompt = prompt;

      const out = num(usage.completion_tokens) || num(usage.output_tokens);
      if (out > 0) outputTokens = Math.max(outputTokens, out);

      const promptDetails = asRecord(usage.prompt_tokens_details) ?? asRecord(usage.input_tokens_details);
      const cached = num(promptDetails?.cached_tokens);
      if (cached > 0) cacheRead = cached;
    }

    if (timings && typeof timings.cache_n === "number") {
      cacheRead = Math.max(cacheRead, num(timings.cache_n));
      if (totalPrompt === 0 && typeof timings.prompt_n === "number") {
        totalPrompt = cacheRead + num(timings.prompt_n);
      }
    }
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
