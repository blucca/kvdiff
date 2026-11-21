import { describe, it, expect } from "vitest";
import { findByteLcp } from "../src/diff/lcp.js";
import { byteOffsetToJsonPath } from "../src/diff/jsonpath.js";

describe("findByteLcp & byteOffsetToJsonPath", () => {
  it("pinpoints exact byte and JSONPath when a tool description changes", () => {
    const a = Buffer.from(
      JSON.stringify({ system: "hi", tools: [{ name: "a", description: "old" }] }),
      "utf8"
    );
    const b = Buffer.from(
      JSON.stringify({ system: "hi", tools: [{ name: "a", description: "new" }] }),
      "utf8"
    );
    const lcp = findByteLcp(a, b);
    expect(lcp.byteOffset).not.toBeNull();
    expect(byteOffsetToJsonPath(b, lcp.byteOffset!)).toBe("$.tools[0].description");
    expect(lcp.prevSnippet).toContain("old");
    expect(lcp.currSnippet).toContain("new");
  });

  it("handles multi-byte UTF-8 emojis and CJK before the break byte accurately (Review Focus #4)", () => {
    const a = Buffer.from(
      JSON.stringify({ system: "🚀 你好世界 — box-drawing ┌─┐", tools: [{ name: "gh", desc: "v1" }] }),
      "utf8"
    );
    const b = Buffer.from(
      JSON.stringify({ system: "🚀 你好世界 — box-drawing ┌─┐", tools: [{ name: "gh", desc: "v2" }] }),
      "utf8"
    );
    const lcp = findByteLcp(a, b);
    expect(lcp.byteOffset).not.toBeNull();
    expect(byteOffsetToJsonPath(b, lcp.byteOffset!)).toBe("$.tools[0].desc");
  });

  it("handles escaped quotes inside JSON strings and nested arrays", () => {
    const a = Buffer.from(
      JSON.stringify({
        system: 'say "hello" \\ world',
        tools: [
          { name: "t0", input_schema: { properties: { x: { type: "string" } } } },
          { name: "t1", input_schema: { properties: { y: { type: "number" } } } },
        ],
      }),
      "utf8"
    );
    const b = Buffer.from(
      JSON.stringify({
        system: 'say "hello" \\ world',
        tools: [
          { name: "t0", input_schema: { properties: { x: { type: "string" } } } },
          { name: "t1", input_schema: { properties: { y: { type: "integer" } } } },
        ],
      }),
      "utf8"
    );
    const lcp = findByteLcp(a, b);
    expect(byteOffsetToJsonPath(b, lcp.byteOffset!)).toBe("$.tools[1].input_schema.properties.y.type");
  });

  it("returns null byteOffset for identical buffers", () => {
    const buf = Buffer.from('{"a":1}', "utf8");
    const lcp = findByteLcp(buf, buf);
    expect(lcp.byteOffset).toBeNull();
    expect(lcp.prevSnippet).toBe("");
    expect(lcp.currSnippet).toBe("");
  });
});
