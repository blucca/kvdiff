import { describe, it, expect, afterEach } from "vitest";
import { KvStore } from "../src/store.js";
import type { TurnRecord } from "../src/types.js";

function makeTurn(sessionId: string, turnIndex: number, overrides: Partial<Omit<TurnRecord, "id">> = {}): Omit<TurnRecord, "id"> {
  return {
    sessionId,
    turnIndex,
    timestampMs: 1_700_000_000_000 + turnIndex * 10_000,
    provider: "anthropic",
    endpoint: "/v1/messages",
    model: "claude-sonnet-4-5",
    statusCode: 200,
    latencyMs: 420,
    healed: false,
    healChanges: [],
    usage: {
      inputTokens: 1_000,
      cacheReadTokens: 90_000,
      cacheWriteTokens: 0,
      outputTokens: 300,
      totalPromptTokens: 91_000,
    },
    costUsd: 0.0345,
    diagnosis: {
      kind: turnIndex === 1 ? "FIRST_TURN" : "NONE",
      byteOffset: null,
      jsonPath: null,
      prevSnippet: "",
      currSnippet: "",
      summary: "Cache hit",
      wastedUsd: 0,
      cacheHitRate: 0.989,
    },
    rawRequestBody: JSON.stringify({ model: "claude-sonnet-4-5", turn: turnIndex }),
    ...overrides,
  };
}

describe("KvStore (node:sqlite)", () => {
  let store: KvStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  it("creates sessions and aggregates turn stats cleanly", () => {
    store = new KvStore(":memory:");
    const sess = store.createSession({ label: "claude code run", command: "claude", healed: false });
    store.recordTurn(makeTurn(sess.id, 1));
    store.recordTurn(
      makeTurn(sess.id, 2, {
        costUsd: 0.45,
        diagnosis: {
          kind: "TOOL_REORDER",
          byteOffset: 18412,
          jsonPath: "$.tools[14].description",
          prevSnippet: "old",
          currSnippet: "new",
          summary: "MCP tool reordered",
          wastedUsd: 0.41,
          cacheHitRate: 0,
        },
      })
    );

    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].turnCount).toBe(2);
    expect(sessions[0].breakCount).toBe(1);
    expect(sessions[0].totalCostUsd).toBeCloseTo(0.4845, 4);
    expect(sessions[0].totalWastedUsd).toBeCloseTo(0.41, 4);
  });

  it("returns turns ordered ascending and getLastTurn returns latest turn", () => {
    store = new KvStore(":memory:");
    const sess = store.createSession({ label: "ordered", healed: true });
    store.recordTurn(makeTurn(sess.id, 1));
    store.recordTurn(makeTurn(sess.id, 2, { healed: true, healChanges: ["sorted 5 tools"] }));
    store.recordTurn(makeTurn(sess.id, 3));

    const turns = store.getSessionTurns(sess.id);
    expect(turns.map((t) => t.turnIndex)).toEqual([1, 2, 3]);
    expect(turns[1].healChanges).toEqual(["sorted 5 tools"]);

    const last = store.getLastTurn(sess.id);
    expect(last?.turnIndex).toBe(3);
  });
});
