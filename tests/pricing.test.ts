import { describe, it, expect } from "vitest";
import { estimateCost, lookupModelPricing } from "../src/pricing.js";

describe("estimateCost", () => {
  it("computes Anthropic cache hit rate and cost accurately", () => {
    const res = estimateCost("claude-sonnet-4-5", {
      inputTokens: 1_000,
      cacheReadTokens: 90_000,
      cacheWriteTokens: 9_000,
      outputTokens: 500,
      totalPromptTokens: 100_000,
    });
    expect(res.cacheHitRate).toBeCloseTo(0.9, 4);
    expect(res.costUsd).toBeGreaterThan(0);
    expect(res.wastedUsd).toBeCloseTo(0, 4);
  });

  it("computes wasted USD when a cacheable prefix misses completely", () => {
    const res = estimateCost(
      "claude-sonnet-4-5",
      {
        inputTokens: 100_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 200,
        totalPromptTokens: 100_000,
      },
      90_000
    );
    expect(res.cacheHitRate).toBe(0);
    expect(res.wastedUsd).toBeGreaterThan(0.2);
  });

  it("computes Gemini cache pricing accurately", () => {
    const rates = lookupModelPricing("gemini-2.5-pro");
    expect(rates.cacheReadPer1M).toBeLessThan(rates.inputPer1M);
    const res = estimateCost(
      "gemini-2.5-pro",
      {
        inputTokens: 50_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 200,
        totalPromptTokens: 50_000,
      },
      40_000
    );
    expect(res.wastedUsd).toBeGreaterThan(0.03);
  });

  it("returns 0 USD cost for local-openai models without NaN", () => {
    const res = estimateCost("local/qwen2.5-coder-32b", {
      inputTokens: 10_000,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 0,
      outputTokens: 300,
      totalPromptTokens: 18_000,
    });
    expect(res.costUsd).toBe(0);
    expect(res.wastedUsd).toBe(0);
    expect(res.cacheHitRate).toBeCloseTo(8 / 18, 4);
  });
});
