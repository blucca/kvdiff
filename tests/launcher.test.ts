import { describe, it, expect } from "vitest";
import { runWrappedCommand } from "../src/launcher/spawn.js";
import { formatExitSummary } from "../src/launcher/hud.js";
import { parseArgs } from "../src/cli.js";
import type { TurnRecord } from "../src/types.js";

describe("launcher & terminal HUD", () => {
  it("injects Anthropic, OpenAI, and Gemini/Antigravity base URLs and preserves child exit code", async () => {
    const script = `
      const ok =
        process.env.ANTHROPIC_BASE_URL === "http://127.0.0.1:4318" &&
        process.env.OPENAI_BASE_URL === "http://127.0.0.1:4318/v1" &&
        process.env.GOOGLE_GEMINI_BASE_URL === "http://127.0.0.1:4318";
      process.exit(ok ? 42 : 1);
    `;
    const code = await runWrappedCommand({
      command: [process.execPath, "-e", script],
      proxyUrl: "http://127.0.0.1:4318",
      sessionId: "sess-1",
    });
    expect(code).toBe(42);
  });

  it("formats exit summary cleanly for both empty and cache-broken sessions", () => {
    const empty = formatExitSummary([], "http://127.0.0.1:4318");
    expect(empty).toContain("0 turns");
    expect(empty).toContain("http://127.0.0.1:4318");

    const turns: TurnRecord[] = [
      {
        id: 1,
        sessionId: "s1",
        turnIndex: 1,
        timestampMs: 1000,
        provider: "anthropic",
        endpoint: "/v1/messages",
        model: "claude-sonnet-4-5",
        statusCode: 200,
        latencyMs: 500,
        healed: false,
        healChanges: [],
        usage: { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 80_000, outputTokens: 200, totalPromptTokens: 81_000 },
        costUsd: 0.3,
        diagnosis: {
          kind: "FIRST_TURN",
          byteOffset: null,
          jsonPath: null,
          prevSnippet: "",
          currSnippet: "",
          summary: "Initial",
          wastedUsd: 0,
          cacheHitRate: 0,
        },
        rawRequestBody: "{}",
      },
      {
        id: 2,
        sessionId: "s1",
        turnIndex: 2,
        timestampMs: 5000,
        provider: "anthropic",
        endpoint: "/v1/messages",
        model: "claude-sonnet-4-5",
        statusCode: 200,
        latencyMs: 800,
        healed: false,
        healChanges: [],
        usage: { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 80_000, outputTokens: 200, totalPromptTokens: 82_000 },
        costUsd: 0.35,
        diagnosis: {
          kind: "TOOL_REORDER",
          byteOffset: 18412,
          jsonPath: "$.tools[14].description",
          prevSnippet: "",
          currSnippet: "",
          summary: "Tool reordered",
          wastedUsd: 0.28,
          cacheHitRate: 0,
        },
        rawRequestBody: "{}",
      },
    ];

    const summary = formatExitSummary(turns, "http://127.0.0.1:4318");
    expect(summary).toContain("2 turns");
    expect(summary).toContain("TOOL_REORDER");
    expect(summary).toContain("$.tools[14].description");
    expect(summary).toContain("$0.28");
  });

  it("Fix #3: handles bare `node` command with `&` and spaces cleanly on Windows", async () => {
    const code = await runWrappedCommand({
      command: ["node", "-e", 'process.exit("hello & world".includes("&") ? 21 : 1)'],
      proxyUrl: "http://127.0.0.1:4318",
      sessionId: "sess-win",
    });
    expect(code).toBe(21);
  });

  it("Fix #11: preserves explicit --port 4318 in wrap mode", () => {
    const explicit = parseArgs(["--port", "4318", "--", "claude"]);
    expect(explicit.port).toBe(4318);
    expect(explicit.portProvided).toBe(true);

    const implicit = parseArgs(["--", "claude"]);
    expect(implicit.portProvided).toBe(false);
  });
});
