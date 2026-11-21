import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

describe("built dist/cli.js smoke check", () => {
  it("runs node dist/cli.js --help cleanly under Node 24 without node:sqlite resolution errors", () => {
    const cliPath = resolve(process.cwd(), "dist", "cli.js");
    const out = execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
    expect(out).toContain("kvdiff v0.1.0");
    expect(out).toContain("--demo");
    expect(out).toContain("--heal");
    expect(out).toContain("--upstream-gemini");
  });
});
