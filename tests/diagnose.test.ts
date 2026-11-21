import { describe, it, expect } from "vitest";
import { diagnoseCacheBreak } from "../src/diff/diagnose.js";
import type { TurnRecord } from "../src/types.js";

function makePrevTurn(body: unknown, overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: 1,
    sessionId: "s1",
    turnIndex: 1,
    timestampMs: 1_700_000_000_000,
    provider: "anthropic",
    endpoint: "/v1/messages",
    model: "claude-sonnet-4-5",
    statusCode: 200,
    latencyMs: 300,
    healed: false,
    healChanges: [],
    usage: {
      inputTokens: 1_000,
      cacheReadTokens: 89_000,
      cacheWriteTokens: 0,
      outputTokens: 200,
      totalPromptTokens: 90_000,
    },
    costUsd: 0.03,
    diagnosis: {
      kind: "NONE",
      byteOffset: null,
      jsonPath: null,
      prevSnippet: "",
      currSnippet: "",
      summary: "ok",
      wastedUsd: 0,
      cacheHitRate: 0.98,
    },
    rawRequestBody: JSON.stringify(body),
    ...overrides,
  };
}

describe("diagnoseCacheBreak", () => {
  it("classifies TOOL_REORDER when MCP tools are shuffled", () => {
    const prev = makePrevTurn({
      model: "claude-sonnet-4-5",
      system: "You are a coder",
      tools: [{ name: "mcp_git" }, { name: "mcp_github" }],
      messages: [{ role: "user", content: "hi" }],
    });
    const currBody = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        system: "You are a coder",
        tools: [{ name: "mcp_github" }, { name: "mcp_git" }],
        messages: [{ role: "user", content: "hi" }, { role: "user", content: "next" }],
      }),
      "utf8"
    );

    const diag = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn: prev,
      currBody,
      currModel: "claude-sonnet-4-5",
      currTimestampMs: prev.timestampMs + 10_000,
      currUsage: { inputTokens: 92_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalPromptTokens: 92_000 },
    });

    expect(diag.kind).toBe("TOOL_REORDER");
    expect(diag.jsonPath).toMatch(/^\$\.tools\[/);
    expect(diag.byteOffset).not.toBeNull();
    expect(diag.wastedUsd).toBeGreaterThan(0.2);
  });

  it("classifies VOLATILE_SYSTEM when system prompt contains a changing timestamp", () => {
    const prev = makePrevTurn({
      model: "claude-sonnet-4-5",
      system: "Current time: 2026-11-21T03:00:00Z",
      messages: [{ role: "user", content: "hi" }],
    });
    const currBody = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        system: "Current time: 2026-11-21T03:01:00Z",
        messages: [{ role: "user", content: "hi" }],
      }),
      "utf8"
    );

    const diag = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn: prev,
      currBody,
      currModel: "claude-sonnet-4-5",
      currTimestampMs: prev.timestampMs + 60_000,
      currUsage: { inputTokens: 90_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalPromptTokens: 90_000 },
    });

    expect(diag.kind).toBe("VOLATILE_SYSTEM");
    expect(diag.jsonPath).toBe("$.system");
  });

  it("classifies TTL_EXPIRED when prefix matches but >5m elapsed with 0 cache reads", () => {
    const prev = makePrevTurn({
      model: "claude-sonnet-4-5",
      system: "Stable system",
      messages: [{ role: "user", content: "turn 1" }],
    });
    const currBody = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        system: "Stable system",
        messages: [{ role: "user", content: "turn 1" }, { role: "user", content: "turn 2" }],
      }),
      "utf8"
    );

    const diag = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn: prev,
      currBody,
      currModel: "claude-sonnet-4-5",
      currTimestampMs: prev.timestampMs + 360_000,
      currUsage: { inputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 91_000, outputTokens: 100, totalPromptTokens: 92_000 },
    });

    expect(diag.kind).toBe("TTL_EXPIRED");
  });

  it("classifies MODEL_CHANGED and PREFIX_TOO_SHORT accurately", () => {
    const prev = makePrevTurn({ model: "claude-sonnet-4-5", messages: [] });
    const modelDiag = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn: prev,
      currBody: Buffer.from(JSON.stringify({ model: "claude-opus-4-5", messages: [] }), "utf8"),
      currModel: "claude-opus-4-5",
      currTimestampMs: prev.timestampMs + 5_000,
      currUsage: { inputTokens: 90_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalPromptTokens: 90_000 },
    });
    expect(modelDiag.kind).toBe("MODEL_CHANGED");

    const shortDiag = diagnoseCacheBreak({
      provider: "openai",
      prevTurn: makePrevTurn({ model: "gpt-4.1", messages: [] }, { provider: "openai", model: "gpt-4.1" }),
      currBody: Buffer.from(JSON.stringify({ model: "gpt-4.1", messages: [{ role: "user", content: "hi" }] }), "utf8"),
      currModel: "gpt-4.1",
      currTimestampMs: prev.timestampMs + 5_000,
      currUsage: { inputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50, totalPromptTokens: 400 },
    });
    expect(shortDiag.kind).toBe("PREFIX_TOO_SHORT");
  });

  it("Fix #9: detects VOLATILE_SYSTEM on OpenAI Responses instructions and avoids false HISTORY_MUTATED on appended turns", () => {
    const prevResp = makePrevTurn(
      { model: "gpt-4.1", instructions: "Now: 03:00", input: [{ role: "user", content: "hi" }] },
      { provider: "openai", model: "gpt-4.1" }
    );
    const currVolatile = Buffer.from(
      JSON.stringify({ model: "gpt-4.1", instructions: "Now: 03:01", input: [{ role: "user", content: "hi" }] }),
      "utf8"
    );
    const diagVol = diagnoseCacheBreak({
      provider: "openai",
      prevTurn: prevResp,
      currBody: currVolatile,
      currModel: "gpt-4.1",
      currTimestampMs: prevResp.timestampMs + 10_000,
      currUsage: { inputTokens: 15_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalPromptTokens: 15_000 },
    });
    expect(diagVol.kind).toBe("VOLATILE_SYSTEM");

    // Normal appended turn with 0 cache read inside 5m window should NOT falsely report HISTORY_MUTATED
    const prevAppend = makePrevTurn({ model: "claude-sonnet-4-5", system: "s", messages: [{ role: "user", content: "a" }] });
    const currAppend = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        system: "s",
        messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }],
      }),
      "utf8"
    );
    const diagAppend = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn: prevAppend,
      currBody: currAppend,
      currModel: "claude-sonnet-4-5",
      currTimestampMs: prevAppend.timestampMs + 10_000,
      currUsage: { inputTokens: 20_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 100, totalPromptTokens: 20_000 },
    });
    expect(diagAppend.kind).not.toBe("HISTORY_MUTATED");
  });
});
