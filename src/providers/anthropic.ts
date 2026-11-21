import type { TokenUsage } from "../types.js";

interface AnthropicUsageShape {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function parseAnthropicUsage(bodyOrSseEvents: unknown): TokenUsage {
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;

  const applyUsage = (u: AnthropicUsageShape | null | undefined): void => {
    if (!u) return;
    if (typeof u.input_tokens === "number") inputTokens = u.input_tokens;
    if (typeof u.cache_read_input_tokens === "number") cacheReadTokens = u.cache_read_input_tokens;
    if (typeof u.cache_creation_input_tokens === "number") cacheWriteTokens = u.cache_creation_input_tokens;
    if (typeof u.output_tokens === "number") outputTokens = Math.max(outputTokens, u.output_tokens);
  };

  if (Array.isArray(bodyOrSseEvents)) {
    for (const ev of bodyOrSseEvents) {
      const rec = asRecord(ev);
      if (!rec) continue;
      if (rec.type === "message_start") {
        const msg = asRecord(rec.message);
        applyUsage(asRecord(msg?.usage) as AnthropicUsageShape | null);
      } else if (rec.type === "message_delta") {
        applyUsage(asRecord(rec.usage) as AnthropicUsageShape | null);
      } else if (rec.usage) {
        applyUsage(asRecord(rec.usage) as AnthropicUsageShape | null);
      }
    }
  } else {
    const rec = asRecord(bodyOrSseEvents);
    if (rec?.usage) {
      applyUsage(asRecord(rec.usage) as AnthropicUsageShape | null);
    }
  }

  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalPromptTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
  };
}
