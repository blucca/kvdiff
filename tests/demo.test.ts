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
    expect(turn14.diagnosis.jsonPath).toBe("$.tools[9].name");
    expect(turn14.diagnosis.byteOffset).toBe(1670);
    expect(turn14.diagnosis.wastedUsd).toBeGreaterThan(0.2);

    // Turn 15 shows --heal snapping cache hit back above 90% with exact Turn 13 tool prefix restored
    const turn13 = turns[12];
    const turn15 = turns[14];
    expect(turn15.healed).toBe(true);
    expect(turn15.healChanges).toEqual(["canonicalized 15 tools and schema keys"]);
    expect(turn15.diagnosis.cacheHitRate).toBeGreaterThan(0.9);
    expect(turn15.diagnosis.kind).toBe("NONE");
    expect(turn15.diagnosis.jsonPath).toBe("$.tools[9].name");
    expect(turn15.diagnosis.jsonPath).not.toBe("$.tools[0].description");
    expect(turn15.diagnosis.byteOffset).toBe(1670);

    // Tools prefix on Turn 15 matches Turn 13 byte-for-byte, and Turn 16 appends cleanly at $.messages[15]
    const turn13Tools = JSON.stringify(JSON.parse(turn13.rawRequestBody).tools);
    const turn15Tools = JSON.stringify(JSON.parse(turn15.rawRequestBody).tools);
    expect(turn15Tools).toBe(turn13Tools);

    const turn16 = turns[15];
    expect(turn16.diagnosis.kind).toBe("NONE");
    expect(turn16.diagnosis.jsonPath).toBe("$.messages[15]");
  });
});
