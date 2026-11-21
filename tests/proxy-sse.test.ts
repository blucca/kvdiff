import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { KvStore } from "../src/store.js";
import { createProxyServer } from "../src/proxy/server.js";

function startMockUpstream(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("bad addr");
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("Zero-Mutation Streaming SSE Proxy & API", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it("preserves exact raw request bytes and OAuth/beta headers in default passthrough mode (Review Focus #1)", async () => {
    let seenHeaders: http.IncomingHttpHeaders = {};
    let seenRawBody = Buffer.alloc(0);

    const upstream = await startMockUpstream((req, res) => {
      seenHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        seenRawBody = Buffer.concat(chunks);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_1",
            usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 50 },
          })
        );
      });
    });
    cleanups.push(() => closeServer(upstream.server));

    const store = new KvStore(":memory:");
    cleanups.push(async () => store.close());
    const proxy = await createProxyServer({
      store,
      port: 0,
      heal: false,
      defaultSessionId: "s-passthrough",
      upstreamAnthropic: upstream.url,
    });
    cleanups.push(() => proxy.close());

    // Deliberately unsorted JSON with weird spacing
    const rawPayload = Buffer.from(
      '{"z_key":1,  "model":"claude-sonnet-4-5", "tools":[{"name":"z"},{"name":"a"}], "messages":[{"role":"user","content":"hi"}]}',
      "utf8"
    );

    const resp = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer oauth-pro-max-secret",
        "anthropic-beta": "prompt-caching-2024-07-31,interleaved-thinking-2025-05-14",
        "anthropic-version": "2023-06-01",
        "x-custom-client": "claude-code-test",
      },
      body: rawPayload,
    });

    expect(resp.status).toBe(200);
    expect(seenRawBody.equals(rawPayload)).toBe(true);
    expect(seenHeaders["authorization"]).toBe("Bearer oauth-pro-max-secret");
    expect(seenHeaders["anthropic-beta"]).toBe("prompt-caching-2024-07-31,interleaved-thinking-2025-05-14");
    expect(seenHeaders["x-custom-client"]).toBe("claude-code-test");
  });

  it("flushes split-chunk SSE streams immediately without buffering and parses usage (Review Focus #2)", async () => {
    const ssePayload =
      `event: message_start\n` +
      `data: {"type":"message_start","message":{"usage":{"input_tokens":500,"cache_read_input_tokens":45000,"cache_creation_input_tokens":0,"output_tokens":5}}}\n\n` +
      `event: content_block_delta\n` +
      `data: {"type":"content_block_delta","delta":{"text":"hello"}}\n\n` +
      `event: message_delta\n` +
      `data: {"type":"message_delta","usage":{"output_tokens":180}}\n\n`;

    let releaseSecondHalf!: () => void;
    const secondHalfGate = new Promise<void>((r) => {
      releaseSecondHalf = r;
    });

    const upstream = await startMockUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const buf = Buffer.from(ssePayload, "utf8");
      const midpoint = Math.floor(buf.length / 2);
      // Write first half in tiny 7-byte chunks
      for (let i = 0; i < midpoint; i += 7) {
        res.write(buf.subarray(i, Math.min(midpoint, i + 7)));
      }
      secondHalfGate.then(() => {
        for (let i = midpoint; i < buf.length; i += 7) {
          res.write(buf.subarray(i, Math.min(buf.length, i + 7)));
        }
        res.end();
      });
    });
    cleanups.push(() => closeServer(upstream.server));

    const store = new KvStore(":memory:");
    cleanups.push(async () => store.close());
    const proxy = await createProxyServer({
      store,
      port: 0,
      heal: false,
      defaultSessionId: "s-sse",
      upstreamAnthropic: upstream.url,
    });
    cleanups.push(() => proxy.close());

    const resp = await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", stream: true, messages: [{ role: "user", content: "hi" }] }),
    });

    const reader = resp.body!.getReader();
    const firstRead = await reader.read();
    // Proves zero-buffering flush BEFORE upstream has closed or sent second half!
    expect(firstRead.done).toBe(false);
    expect(firstRead.value!.byteLength).toBeGreaterThan(0);

    releaseSecondHalf();
    while (!(await reader.read()).done) {
      // drain
    }

    // Small tick for SQLite persistence callback
    await new Promise((r) => setTimeout(r, 40));
    const turns = store.getSessionTurns("s-sse");
    expect(turns).toHaveLength(1);
    expect(turns[0].usage.cacheReadTokens).toBe(45_000);
    expect(turns[0].usage.outputTokens).toBe(180);
  });

  it("decompresses gzip request and response payloads for accurate inspection (Review Focus #3)", async () => {
    const upstream = await startMockUpstream((_req, res) => {
      const jsonResp = JSON.stringify({
        usageMetadata: { promptTokenCount: 12_000, cachedContentTokenCount: 10_000, candidatesTokenCount: 250 },
      });
      const gz = gzipSync(Buffer.from(jsonResp, "utf8"));
      res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      res.end(gz);
    });
    cleanups.push(() => closeServer(upstream.server));

    const store = new KvStore(":memory:");
    cleanups.push(async () => store.close());
    const proxy = await createProxyServer({
      store,
      port: 0,
      heal: false,
      defaultSessionId: "s-gzip",
      upstreamGemini: upstream.url,
    });
    cleanups.push(() => proxy.close());

    const reqJson = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hello antigravity" }] }] });
    const resp = await fetch(`${proxy.url}/v1beta/models/gemini-2.5-pro:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: gzipSync(Buffer.from(reqJson, "utf8")),
    });

    expect(resp.status).toBe(200);
    await resp.text();
    await new Promise((r) => setTimeout(r, 30));

    const turns = store.getSessionTurns("s-gzip");
    expect(turns).toHaveLength(1);
    expect(turns[0].provider).toBe("gemini");
    expect(turns[0].model).toBe("gemini-2.5-pro");
    expect(turns[0].usage.cacheReadTokens).toBe(10_000);
    expect(turns[0].rawRequestBody).toContain("hello antigravity");
  });

  it("heals shuffled tools when --heal is enabled and exposes /__kvdiff/api endpoints", async () => {
    const receivedBodies: Buffer[] = [];
    const upstream = await startMockUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        receivedBodies.push(Buffer.concat(chunks));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            usage: { input_tokens: 1000, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0, output_tokens: 50 },
          })
        );
      });
    });
    cleanups.push(() => closeServer(upstream.server));

    const store = new KvStore(":memory:");
    cleanups.push(async () => store.close());
    const proxy = await createProxyServer({
      store,
      port: 0,
      heal: true,
      defaultSessionId: "s-heal",
      upstreamAnthropic: upstream.url,
    });
    cleanups.push(() => proxy.close());

    await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", tools: [{ name: "z" }, { name: "a" }], messages: [] }),
    });
    await fetch(`${proxy.url}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", tools: [{ name: "a" }, { name: "z" }], messages: [] }),
    });

    expect(receivedBodies).toHaveLength(2);
    expect(receivedBodies[0].equals(receivedBodies[1])).toBe(true);

    const sessionsResp = await fetch(`${proxy.url}/__kvdiff/api/sessions`);
    const sessions = (await sessionsResp.json()) as Array<{ id: string; turnCount: number }>;
    expect(sessions[0].id).toBe("s-heal");
    expect(sessions[0].turnCount).toBe(2);
  });
});
