import { describe, it, expect } from "vitest";
import { detectProvider } from "../src/providers/detect.js";
import { parseAnthropicUsage } from "../src/providers/anthropic.js";
import { parseOpenAiUsage } from "../src/providers/openai.js";
import { parseGeminiUsage, extractGeminiModel } from "../src/providers/gemini.js";

describe("provider detection & usage parsers", () => {
  it("detects anthropic, gemini/antigravity, openai, and local-openai routes", () => {
    expect(detectProvider("/v1/messages", {}, false)).toBe("anthropic");
    expect(detectProvider("/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", {}, false)).toBe("gemini");
    expect(detectProvider("/v1/models/gemini-4-neon:generateContent", {}, false)).toBe("gemini");
    expect(detectProvider("/v1/responses", {}, false)).toBe("openai");
    expect(detectProvider("/v1/chat/completions", {}, true)).toBe("local-openai");
  });

  it("parses Anthropic SSE message_start and message_delta usage", () => {
    const usage = parseAnthropicUsage([
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 1_200,
            cache_read_input_tokens: 88_000,
            cache_creation_input_tokens: 4_000,
            output_tokens: 10,
          },
        },
      },
      {
        type: "message_delta",
        usage: { output_tokens: 450 },
      },
    ]);
    expect(usage.inputTokens).toBe(1_200);
    expect(usage.cacheReadTokens).toBe(88_000);
    expect(usage.cacheWriteTokens).toBe(4_000);
    expect(usage.outputTokens).toBe(450);
    expect(usage.totalPromptTokens).toBe(93_200);
  });

  it("parses OpenAI Responses, Chat Completions, and llama.cpp timings.cache_n", () => {
    const responsesUsage = parseOpenAiUsage({
      usage: {
        input_tokens: 20_000,
        input_tokens_details: { cached_tokens: 18_000 },
        output_tokens: 300,
      },
    });
    expect(responsesUsage.cacheReadTokens).toBe(18_000);
    expect(responsesUsage.inputTokens).toBe(2_000);
    expect(responsesUsage.totalPromptTokens).toBe(20_000);

    const llamaUsage = parseOpenAiUsage({
      usage: { prompt_tokens: 12_000, completion_tokens: 200 },
      timings: { cache_n: 10_500 },
    });
    expect(llamaUsage.cacheReadTokens).toBe(10_500);
    expect(llamaUsage.inputTokens).toBe(1_500);
    expect(llamaUsage.totalPromptTokens).toBe(12_000);
  });

  it("parses Gemini / Antigravity usageMetadata and extracts model from path", () => {
    expect(extractGeminiModel("/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse")).toBe("gemini-2.5-pro");
    const usage = parseGeminiUsage([
      {
        usageMetadata: {
          promptTokenCount: 42_000,
          cachedContentTokenCount: 38_000,
          candidatesTokenCount: 620,
        },
      },
    ]);
    expect(usage.cacheReadTokens).toBe(38_000);
    expect(usage.inputTokens).toBe(4_000);
    expect(usage.outputTokens).toBe(620);
    expect(usage.totalPromptTokens).toBe(42_000);
  });
});
