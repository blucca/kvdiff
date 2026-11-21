import type { KvStore } from "../store.js";
import type { TokenUsage } from "../types.js";
import { diagnoseCacheBreak } from "../diff/diagnose.js";
import { healRequestPayload } from "../heal/canonicalize.js";
import { estimateCost } from "../pricing.js";

function buildMcpTools(shuffled: boolean): Array<Record<string, unknown>> {
  const baseTools = [
    { name: "bash_exec", description: "Execute a shell command in the workspace.", input_schema: { type: "object", properties: { cmd: { type: "string" } } } },
    { name: "edit_file", description: "Apply a surgical replacement edit to a file.", input_schema: { type: "object", properties: { path: { type: "string" }, target: { type: "string" } } } },
    { name: "git_diff", description: "Inspect unstaged and staged git hunks.", input_schema: { type: "object", properties: { base: { type: "string" } } } },
    { name: "git_status", description: "Check branch state and modified files.", input_schema: { type: "object", properties: { short: { type: "boolean" } } } },
    { name: "grep_search", description: "Search files with ripgrep regex.", input_schema: { type: "object", properties: { query: { type: "string" } } } },
    { name: "list_dir", description: "List directory contents and file sizes.", input_schema: { type: "object", properties: { dir: { type: "string" } } } },
    { name: "mcp_db_query", description: "Run read-only SQL query against staging Postgres.", input_schema: { type: "object", properties: { sql: { type: "string" } } } },
    { name: "mcp_db_schema", description: "Inspect table schemas and indexes.", input_schema: { type: "object", properties: { table: { type: "string" } } } },
    { name: "mcp_docker_logs", description: "Tail container logs from local Docker Compose.", input_schema: { type: "object", properties: { service: { type: "string" } } } },
    { name: "mcp_github_get_pr", description: "Fetch GitHub pull request metadata and diff.", input_schema: { type: "object", properties: { pr: { type: "number" } } } },
    { name: "mcp_github_list_issues", description: "List open issues in the repository.", input_schema: { type: "object", properties: { label: { type: "string" } } } },
    { name: "mcp_github_review", description: "Post inline review comments on a GitHub PR.", input_schema: { type: "object", properties: { body: { type: "string" } } } },
    { name: "mcp_linear_issue", description: "Read or update a Linear ticket status.", input_schema: { type: "object", properties: { id: { type: "string" } } } },
    { name: "mcp_playwright_snap", description: "Capture DOM snapshot from local dev server.", input_schema: { type: "object", properties: { url: { type: "string" } } } },
    { name: "mcp_sentry_errors", description: "Query recent production stack traces.", input_schema: { type: "object", properties: { env: { type: "string" } } } },
  ];

  if (!shuffled) return baseTools;

  // Simulate mcp-github reconnecting and re-registering tools in a different order at index 9..14
  const copy = [...baseTools];
  const [ghReview] = copy.splice(11, 1);
  const [ghPr] = copy.splice(9, 1);
  copy.splice(14, 0, ghReview);
  copy.splice(13, 0, ghPr);
  return copy;
}

export function seedDemoSession(store: KvStore): string {
  const now = Date.now();
  const baseTs = now - 16 * 22_000;
  const sessionId = "demo-claude-mcp";

  store.createSession({
    id: sessionId,
    label: "claude-code · checkout-refactor (15 MCP tools)",
    command: "kvdiff -- claude",
    healed: false,
    createdAtMs: baseTs,
  });

  const model = "claude-sonnet-4-5";
  const systemPrompt =
    "You are an expert TypeScript systems engineer working on the checkout-service monorepo. Follow strict TDD, avoid unverified assumptions, and keep database migrations reversible.";
  const messages: Array<{ role: string; content: string }> = [];

  for (let turn = 1; turn <= 16; turn++) {
    messages.push({
      role: turn % 2 === 1 ? "user" : "assistant",
      content:
        turn === 1
          ? "Audit checkout webhook idempotency and fix duplicate charge race condition."
          : `Turn ${turn}: inspected src/webhooks/stripe.ts and verified lock-key isolation.`,
    });

    const isTurn14Bust = turn === 14;
    const isHealedTurn = turn >= 15;
    const rawPayload = Buffer.from(
      JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: buildMcpTools(isTurn14Bust || isHealedTurn),
        messages: [...messages],
      }),
      "utf8"
    );

    let effectiveBody: Buffer = rawPayload;
    let healed = false;
    let healChanges: string[] = [];
    if (isHealedTurn) {
      const res = healRequestPayload("anthropic", rawPayload);
      effectiveBody = res.body;
      healed = res.changes.length > 0;
      healChanges = res.changes;
    }

    const totalPrompt = 78_000 + turn * 2_400;
    let usage: TokenUsage;
    if (turn === 1) {
      usage = {
        inputTokens: 1_200,
        cacheReadTokens: 0,
        cacheWriteTokens: totalPrompt - 1_200,
        outputTokens: 640,
        totalPromptTokens: totalPrompt,
      };
    } else if (isTurn14Bust) {
      // Cache completely invalidated by mcp-github tool reorder!
      usage = {
        inputTokens: 2_100,
        cacheReadTokens: 0,
        cacheWriteTokens: totalPrompt - 2_100,
        outputTokens: 520,
        totalPromptTokens: totalPrompt,
      };
    } else if (turn === 15) {
      // --heal restored deterministic tool order -> 97% cache hit!
      const cacheRead = Math.round(totalPrompt * 0.97);
      usage = {
        inputTokens: totalPrompt - cacheRead,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: 0,
        outputTokens: 480,
        totalPromptTokens: totalPrompt,
      };
    } else {
      const cacheRead = Math.round(totalPrompt * 0.94);
      const cacheWrite = Math.round(totalPrompt * 0.04);
      usage = {
        inputTokens: totalPrompt - cacheRead - cacheWrite,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: 410 + turn * 15,
        totalPromptTokens: totalPrompt,
      };
    }

    const prevTurn = store.getLastTurn(sessionId);
    const ts = baseTs + turn * 20_000;
    const diagnosis = diagnoseCacheBreak({
      provider: "anthropic",
      prevTurn,
      currBody: effectiveBody,
      currModel: model,
      currTimestampMs: ts,
      currUsage: usage,
    });
    const { costUsd } = estimateCost(model, usage, prevTurn?.usage.totalPromptTokens ?? 0);

    store.recordTurn({
      sessionId,
      turnIndex: turn,
      timestampMs: ts,
      provider: "anthropic",
      endpoint: "/v1/messages",
      model,
      statusCode: 200,
      latencyMs: isTurn14Bust ? 2_480 : 620 + (turn % 5) * 90,
      healed,
      healChanges,
      usage,
      costUsd,
      diagnosis,
      rawRequestBody: effectiveBody.toString("utf8"),
    });
  }

  // Bonus second demo session: Antigravity / Gemini 2.5 Pro catching a volatile timestamp in systemInstruction
  const geminiSessionId = "demo-antigravity-gemini";
  store.createSession({
    id: geminiSessionId,
    label: "antigravity · gemini-2.5-pro (volatile systemInstruction)",
    command: "kvdiff serve --port 4318",
    healed: false,
    createdAtMs: baseTs - 60_000,
  });

  const gModel = "gemini-2.5-pro";
  for (let t = 1; t <= 5; t++) {
    const volatile = t === 4;
    const gBody = Buffer.from(
      JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: volatile
                ? "Antigravity agent context | local_time=2026-11-21T03:24:11Z"
                : "Antigravity agent context | local_time=2026-11-21T03:20:00Z",
            },
          ],
        },
        contents: Array.from({ length: t }, (_, idx) => ({
          role: idx % 2 === 0 ? "user" : "model",
          parts: [{ text: `Step ${idx + 1}: verify cache behavior` }],
        })),
      }),
      "utf8"
    );

    const totalPrompt = 52_000 + t * 3_000;
    const cacheRead = t === 1 || volatile ? 0 : Math.round(totalPrompt * 0.92);
    const usage: TokenUsage = {
      inputTokens: totalPrompt - cacheRead,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: 0,
      outputTokens: 380,
      totalPromptTokens: totalPrompt,
    };
    const prevTurn = store.getLastTurn(geminiSessionId);
    const ts = baseTs - 60_000 + t * 18_000;
    const diagnosis = diagnoseCacheBreak({
      provider: "gemini",
      prevTurn,
      currBody: gBody,
      currModel: gModel,
      currTimestampMs: ts,
      currUsage: usage,
    });
    const { costUsd } = estimateCost(gModel, usage, prevTurn?.usage.totalPromptTokens ?? 0);

    store.recordTurn({
      sessionId: geminiSessionId,
      turnIndex: t,
      timestampMs: ts,
      provider: "gemini",
      endpoint: "/v1beta/models/gemini-2.5-pro:streamGenerateContent",
      model: gModel,
      statusCode: 200,
      latencyMs: volatile ? 1_920 : 540,
      healed: false,
      healChanges: [],
      usage,
      costUsd,
      diagnosis,
      rawRequestBody: gBody.toString("utf8"),
    });
  }

  return sessionId;
}
