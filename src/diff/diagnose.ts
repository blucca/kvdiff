import type { CacheBreakKind, CacheDiagnosis, ProviderKind, TokenUsage, TurnRecord } from "../types.js";
import { findByteLcp } from "./lcp.js";
import { byteOffsetToJsonPath } from "./jsonpath.js";
import { estimateCost } from "../pricing.js";

const ANTHROPIC_DEFAULT_TTL_MS = 300_000; // 5 minutes
const OPENAI_MIN_CACHE_TOKENS = 1_024;
const GEMINI_FLASH_MIN_CACHE_TOKENS = 1_024;
const GEMINI_PRO_MIN_CACHE_TOKENS = 2_048;

function safeJsonParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractToolNames(provider: ProviderKind, obj: Record<string, unknown> | null): string[] {
  if (!obj || !Array.isArray(obj.tools)) return [];
  if (provider === "gemini") {
    const names: string[] = [];
    for (const block of obj.tools) {
      if (block && typeof block === "object" && Array.isArray((block as Record<string, unknown>).functionDeclarations)) {
        for (const decl of (block as Record<string, unknown>).functionDeclarations as unknown[]) {
          if (decl && typeof decl === "object" && typeof (decl as Record<string, unknown>).name === "string") {
            names.push((decl as Record<string, unknown>).name as string);
          }
        }
      }
    }
    return names;
  }

  const names: string[] = [];
  for (const tool of obj.tools) {
    if (!tool || typeof tool !== "object") continue;
    const rec = tool as Record<string, unknown>;
    if (typeof rec.name === "string") {
      names.push(rec.name);
    } else if (rec.function && typeof rec.function === "object" && typeof (rec.function as Record<string, unknown>).name === "string") {
      names.push((rec.function as Record<string, unknown>).name as string);
    }
  }
  return names;
}

function sameMultisetDifferentOrder(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let different = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      different = true;
      break;
    }
  }
  if (!different) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, idx) => v === sortedB[idx]);
}

function isOnlyAppendedTurn(prevObj: Record<string, unknown> | null, currObj: Record<string, unknown> | null, jsonPath: string | null): boolean {
  if (!prevObj || !currObj || !jsonPath) return false;
  const key = Array.isArray(prevObj.messages)
    ? "messages"
    : Array.isArray(prevObj.contents)
      ? "contents"
      : Array.isArray(prevObj.input)
        ? "input"
        : null;
  if (!key) return false;
  const prevLen = (prevObj[key] as unknown[]).length;
  const match = new RegExp(`^\\$\\.${key}\\[(\\d+)\\]`).exec(jsonPath);
  if (!match) {
    // Also check divergence right at the closing bracket of the conversation array
    return jsonPath === `$.${key}` && Array.isArray(currObj[key]) && (currObj[key] as unknown[]).length > prevLen;
  }
  return Number(match[1]) >= prevLen;
}

export function diagnoseCacheBreak(params: {
  provider: ProviderKind;
  prevTurn: TurnRecord | null;
  currBody: Buffer;
  currModel: string;
  currTimestampMs: number;
  currUsage: TokenUsage;
}): CacheDiagnosis {
  const { provider, prevTurn, currBody, currModel, currTimestampMs, currUsage } = params;

  const expectedCacheable = prevTurn ? prevTurn.usage.totalPromptTokens : 0;
  const { cacheHitRate, wastedUsd } = estimateCost(currModel, currUsage, expectedCacheable);

  if (!prevTurn) {
    return {
      kind: "FIRST_TURN",
      byteOffset: null,
      jsonPath: null,
      prevSnippet: "",
      currSnippet: "",
      summary: "Initial turn — warming prompt cache prefix.",
      wastedUsd: 0,
      cacheHitRate,
    };
  }

  // Check if cache actually hit strongly (normal append)
  const prevBuf = Buffer.from(prevTurn.rawRequestBody, "utf8");
  const lcp = findByteLcp(prevBuf, currBody);
  const jsonPath = lcp.byteOffset !== null ? byteOffsetToJsonPath(currBody, lcp.byteOffset) : null;

  const prevObj = safeJsonParse(prevTurn.rawRequestBody);
  const currObj = safeJsonParse(currBody.toString("utf8"));

  const isHealthyHit =
    currUsage.cacheReadTokens > 0 &&
    (expectedCacheable === 0 || currUsage.cacheReadTokens >= expectedCacheable * 0.6);

  if (isHealthyHit) {
    return {
      kind: "NONE",
      byteOffset: lcp.byteOffset,
      jsonPath,
      prevSnippet: lcp.prevSnippet,
      currSnippet: lcp.currSnippet,
      summary: `Cache hit (${Math.round(cacheHitRate * 100)}%) — prefix stayed stable.`,
      wastedUsd: 0,
      cacheHitRate,
    };
  }

  // Classify root cause when cache missed or dropped sharply
  let kind: CacheBreakKind = "UNKNOWN";
  let summary = `Cache miss at byte ${lcp.byteOffset ?? 0} (${jsonPath ?? "$"}).`;

  if (currModel !== prevTurn.model) {
    kind = "MODEL_CHANGED";
    summary = `Model switched from ${prevTurn.model} to ${currModel}, invalidating KV prefix.`;
  } else if (
    (provider === "openai" && currUsage.totalPromptTokens > 0 && currUsage.totalPromptTokens < OPENAI_MIN_CACHE_TOKENS) ||
    (provider === "gemini" &&
      currUsage.totalPromptTokens > 0 &&
      currUsage.totalPromptTokens < (/flash/i.test(currModel) ? GEMINI_FLASH_MIN_CACHE_TOKENS : GEMINI_PRO_MIN_CACHE_TOKENS))
  ) {
    kind = "PREFIX_TOO_SHORT";
    summary = `Prompt (${currUsage.totalPromptTokens} tokens) is below ${provider} minimum implicit-cache prefix threshold.`;
  } else if (jsonPath?.startsWith("$.tools")) {
    const prevTools = extractToolNames(provider, prevObj);
    const currTools = extractToolNames(provider, currObj);
    if (sameMultisetDifferentOrder(prevTools, currTools)) {
      kind = "TOOL_REORDER";
      summary = `Tool definitions reordered at ${jsonPath} (byte ${lcp.byteOffset}). Enable --heal to sort tools deterministically.`;
    } else {
      kind = "TOOL_MUTATED";
      summary = `Tool schema or description mutated at ${jsonPath} (byte ${lcp.byteOffset}).`;
    }
  } else if (
    jsonPath?.startsWith("$.system") ||
    jsonPath?.startsWith("$.systemInstruction") ||
    jsonPath?.startsWith("$.instructions") ||
    jsonPath === "$.messages[0]" ||
    jsonPath?.startsWith("$.messages[0].") ||
    jsonPath === "$.input[0]" ||
    jsonPath?.startsWith("$.input[0].")
  ) {
    kind = "VOLATILE_SYSTEM";
    summary = `System prompt changed at ${jsonPath} (byte ${lcp.byteOffset}) — check for timestamps, UUIDs, or dynamic state.`;
  } else if (
    (lcp.byteOffset === null || isOnlyAppendedTurn(prevObj, currObj, jsonPath)) &&
    currUsage.cacheReadTokens === 0 &&
    currTimestampMs - prevTurn.timestampMs > ANTHROPIC_DEFAULT_TTL_MS
  ) {
    kind = "TTL_EXPIRED";
    const gapSec = Math.round((currTimestampMs - prevTurn.timestampMs) / 1000);
    summary = `Prefix bytes matched, but ${gapSec}s elapsed since previous turn (>5m cache TTL).`;
  } else if (
    !isOnlyAppendedTurn(prevObj, currObj, jsonPath) &&
    (jsonPath?.startsWith("$.messages[") || jsonPath?.startsWith("$.contents[") || jsonPath?.startsWith("$.input["))
  ) {
    kind = "HISTORY_MUTATED";
    summary = `Earlier conversation history mutated at ${jsonPath} (byte ${lcp.byteOffset}).`;
  }

  return {
    kind,
    byteOffset: lcp.byteOffset,
    jsonPath,
    prevSnippet: lcp.prevSnippet,
    currSnippet: lcp.currSnippet,
    summary,
    wastedUsd: kind === "PREFIX_TOO_SHORT" ? 0 : wastedUsd,
    cacheHitRate,
  };
}
