import { describe, it, expect } from "vitest";
import { healRequestPayload } from "../src/heal/canonicalize.js";

describe("healRequestPayload (Review Focus #5)", () => {
  it("canonicalizes shuffled Anthropic tools and tool schema keys into byte-identical prefixes", () => {
    const reqA = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        tools: [
          { name: "z_tool", input_schema: { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } } },
          { name: "a_tool", input_schema: { properties: { x: { type: "string", enum: ["z", "a", "m"] } }, type: "object" } },
        ],
        messages: [
          { role: "user", content: [{ type: "text", text: "second?" }, { type: "text", text: "first!" }] },
          { role: "assistant", content: "reply" },
        ],
      }),
      "utf8"
    );

    const reqB = Buffer.from(
      JSON.stringify({
        model: "claude-sonnet-4-5",
        tools: [
          { name: "a_tool", input_schema: { type: "object", properties: { x: { enum: ["z", "a", "m"], type: "string" } } } },
          { name: "z_tool", input_schema: { properties: { a: { type: "number" }, b: { type: "string" } }, type: "object" } },
        ],
        messages: [
          { role: "user", content: [{ type: "text", text: "second?" }, { type: "text", text: "first!" }] },
          { role: "assistant", content: "reply" },
        ],
      }),
      "utf8"
    );

    const healedA = healRequestPayload("anthropic", reqA);
    const healedB = healRequestPayload("anthropic", reqB);

    expect(healedA.body.equals(healedB.body)).toBe(true);
    expect(healedA.changes.length).toBeGreaterThan(0);

    // Order-sensitive arrays MUST NEVER be reordered
    const parsed = JSON.parse(healedA.body.toString("utf8"));
    expect(parsed.messages[0].content[0].text).toBe("second?");
    expect(parsed.messages[0].content[1].text).toBe("first!");
    expect(parsed.tools[0].input_schema.properties.x.enum).toEqual(["z", "a", "m"]);
  });

  it("canonicalizes Gemini / Antigravity tools[].functionDeclarations[] without reordering contents[] or parts[]", () => {
    const reqA = Buffer.from(
      JSON.stringify({
        tools: [
          {
            functionDeclarations: [
              { name: "write_file", parameters: { properties: { b: { type: "STRING" }, a: { type: "STRING" } }, type: "OBJECT" } },
              { name: "read_file", parameters: { type: "OBJECT", properties: { path: { type: "STRING" } } } },
            ],
          },
        ],
        contents: [
          { role: "user", parts: [{ text: "step 2" }, { text: "step 1" }] },
        ],
      }),
      "utf8"
    );

    const reqB = Buffer.from(
      JSON.stringify({
        tools: [
          {
            functionDeclarations: [
              { name: "read_file", parameters: { properties: { path: { type: "STRING" } }, type: "OBJECT" } },
              { name: "write_file", parameters: { type: "OBJECT", properties: { a: { type: "STRING" }, b: { type: "STRING" } } } },
            ],
          },
        ],
        contents: [
          { role: "user", parts: [{ text: "step 2" }, { text: "step 1" }] },
        ],
      }),
      "utf8"
    );

    const healedA = healRequestPayload("gemini", reqA);
    const healedB = healRequestPayload("gemini", reqB);

    expect(healedA.body.equals(healedB.body)).toBe(true);
    const parsed = JSON.parse(healedA.body.toString("utf8"));
    expect(parsed.contents[0].parts.map((p: { text: string }) => p.text)).toEqual(["step 2", "step 1"]);
  });
});
