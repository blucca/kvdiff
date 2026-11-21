import type { ModelRates, TokenUsage } from "./types.js";

const ZERO_RATES: ModelRates = {
  inputPer1M: 0,
  cacheReadPer1M: 0,
  cacheWritePer1M: 0,
  outputPer1M: 0,
};

const MODEL_PRICING_TABLE: Array<{ match: RegExp; rates: ModelRates }> = [
  // Local / self-hosted provider prefixes always $0 even when proxying cloud-like names
  {
    match: /^(?:local\/|ollama\/|vllm\/)/i,
    rates: ZERO_RATES,
  },
  // Anthropic Claude
  {
    match: /claude-(?:opus-4|4-opus|3-opus)/i,
    rates: { inputPer1M: 15, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75, outputPer1M: 75 },
  },
  {
    match: /claude-(?:sonnet-4|4-sonnet|3-[57]-sonnet)/i,
    rates: { inputPer1M: 3, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75, outputPer1M: 15 },
  },
  {
    match: /claude-(?:haiku-4|4-haiku|3-5-haiku|3-haiku)/i,
    rates: { inputPer1M: 0.8, cacheReadPer1M: 0.08, cacheWritePer1M: 1.0, outputPer1M: 4 },
  },
  // OpenAI GPT / o-series / Codex (check mini and codex variants before flagship gpt-5)
  {
    match: /(?:^|\/)(?:gpt-5(?:\.\d+)?(?:-[a-z0-9]+)*-mini|gpt-4\.1-mini|gpt-4o-mini|o4-mini|o3-mini|codex-mini)/i,
    rates: { inputPer1M: 0.4, cacheReadPer1M: 0.1, cacheWritePer1M: 0.4, outputPer1M: 1.6 },
  },
  {
    match: /(?:^|\/)(?:gpt-5(?:\.\d+)?-codex|o3|codex)/i,
    rates: { inputPer1M: 2.0, cacheReadPer1M: 0.5, cacheWritePer1M: 2.0, outputPer1M: 8 },
  },
  {
    match: /(?:^|\/)(?:gpt-5|gpt-4\.1|gpt-4o)(?!.*mini)/i,
    rates: { inputPer1M: 2.5, cacheReadPer1M: 0.625, cacheWritePer1M: 2.5, outputPer1M: 10 },
  },
  // Google Gemini / Antigravity
  {
    match: /gemini-(?:4|3|2\.5)-pro|gemini-4-neon/i,
    rates: { inputPer1M: 1.25, cacheReadPer1M: 0.3125, cacheWritePer1M: 1.25, outputPer1M: 10 },
  },
  {
    match: /gemini-(?:4|3|2\.5|2\.0)-flash/i,
    rates: { inputPer1M: 0.15, cacheReadPer1M: 0.0375, cacheWritePer1M: 0.15, outputPer1M: 0.6 },
  },
  // OSS self-hosted weights (llama.cpp, vLLM, Ollama, mlx-lm)
  {
    match: /(?:qwen|llama|deepseek|mistral|gemma|phi-|codestral)/i,
    rates: ZERO_RATES,
  },
];

export function lookupModelPricing(model: string): ModelRates {
  const normalized = (model || "").trim();
  if (!normalized) return ZERO_RATES;
  for (const entry of MODEL_PRICING_TABLE) {
    if (entry.match.test(normalized)) {
      return entry.rates;
    }
  }
  return ZERO_RATES;
}

export function estimateCost(
  model: string,
  usage: TokenUsage,
  expectedCacheableTokens = 0
): { costUsd: number; wastedUsd: number; cacheHitRate: number } {
  const rates = lookupModelPricing(model);
  const totalPrompt =
    usage.totalPromptTokens > 0
      ? usage.totalPromptTokens
      : usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

  const cacheHitRate = totalPrompt > 0 ? Math.min(1, Math.max(0, usage.cacheReadTokens / totalPrompt)) : 0;

  const costUsd =
    (usage.inputTokens * rates.inputPer1M +
      usage.cacheReadTokens * rates.cacheReadPer1M +
      usage.cacheWriteTokens * rates.cacheWritePer1M +
      usage.outputTokens * rates.outputPer1M) /
    1_000_000;

  let wastedUsd = 0;
  if (expectedCacheableTokens > 0 && rates.inputPer1M > rates.cacheReadPer1M) {
    const missedTokens = Math.max(0, Math.min(expectedCacheableTokens, totalPrompt) - usage.cacheReadTokens);
    const rewroteTokens = Math.min(missedTokens, usage.cacheWriteTokens);
    const plainUncachedTokens = Math.max(0, missedTokens - rewroteTokens);
    wastedUsd =
      (rewroteTokens * Math.max(0, rates.cacheWritePer1M - rates.cacheReadPer1M) +
        plainUncachedTokens * Math.max(0, rates.inputPer1M - rates.cacheReadPer1M)) /
      1_000_000;
  }

  return {
    costUsd: Number.isFinite(costUsd) ? costUsd : 0,
    wastedUsd: Number.isFinite(wastedUsd) ? wastedUsd : 0,
    cacheHitRate: Number.isFinite(cacheHitRate) ? cacheHitRate : 0,
  };
}
