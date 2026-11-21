import { describe, it, expect, afterEach } from "vitest";
import { KvStore } from "../src/store.js";
import { seedDemoSession } from "../src/demo/fixture.js";

describe("seedDemoSession (--demo fixture)", () => {
  let store: KvStore | null = null;

  afterEach(() => {
    store?.close();
    store = null;
  });

  it("runs the real diagnosis engine across a 16-turn session with Turn 14 MCP cache bust and Turn 15 --heal recovery", () => {
    store = new KvStore(":memory:");
    const sessionId = seedDemoSession(store);
    const turns = store.getSessionTurns(sessionId);

    expect(turns).toHaveLength(16);
    // Turn 14 is the showcase MCP tool-reorder cache bust
    const turn14 = turns[13];
    expect(turn14.turnIndex).toBe(14);
    expect(turn14.diagnosis.kind).toBe("TOOL_REORDER");
    expect(turn14.diagnosis.jsonPath).toMatch(/^\$\.tools\[/);
    expect(turn14.diagnosis.byteOffset).toBeGreaterThan(0);
    expect(turn14.diagnosis.wastedUsd).toBeGreaterThan(0.2);

    // Turn 15 shows --heal snapping cache hit back above 90%
    const turn15 = turns[14];
    expect(turn15.healed).toBe(true);
    expect(turn15.healChanges.length).toBeGreaterThan(0);
    expect(turn15.diagnosis.cacheHitRate).toBeGreaterThan(0.9);
    expect(turn15.diagnosis.kind).toBe("NONE");
  });
});
