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

  it("returns $0 for local/ollama/vllm prefixed cloud model names", () => {
    for (const model of [
      "local/gemini-2.5-pro",
      "local/claude-sonnet-4-5",
      "ollama/claude-3-5-sonnet",
      "vllm/gpt-5",
    ]) {
      const rates = lookupModelPricing(model);
      expect(rates.inputPer1M).toBe(0);
      expect(rates.cacheReadPer1M).toBe(0);
      expect(rates.outputPer1M).toBe(0);
      const res = estimateCost(
        model,
        {
          inputTokens: 50_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 500,
          totalPromptTokens: 50_000,
        },
        40_000
      );
      expect(res.costUsd).toBe(0);
      expect(res.wastedUsd).toBe(0);
    }
  });

  it("matches gpt-5.1-codex-mini and gpt-5.*-codex variants to OpenAI mini/codex pricing", () => {
    for (const miniModel of ["gpt-5.1-codex-mini", "openai/gpt-5.1-codex-mini", "gpt-5-codex-mini"]) {
      const rates = lookupModelPricing(miniModel);
      expect(rates.inputPer1M).toBe(0.4);
      expect(rates.cacheReadPer1M).toBe(0.1);
      expect(rates.outputPer1M).toBe(1.6);
    }

    for (const codexModel of ["gpt-5.1-codex", "gpt-5-codex", "openai/gpt-5.2-codex"]) {
      const rates = lookupModelPricing(codexModel);
      expect(rates.inputPer1M).toBe(2.0);
      expect(rates.cacheReadPer1M).toBe(0.5);
      expect(rates.outputPer1M).toBe(8);
    }

    expect(lookupModelPricing("gpt-5").inputPer1M).toBe(2.5);
  });
});
