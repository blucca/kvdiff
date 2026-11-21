export type ProviderKind = "anthropic" | "openai" | "gemini" | "local-openai";

export type CacheBreakKind =
  | "NONE"
  | "FIRST_TURN"
  | "TOOL_REORDER"
  | "TOOL_MUTATED"
  | "VOLATILE_SYSTEM"
  | "TTL_EXPIRED"
  | "LOOKBACK_MISS"
  | "PREFIX_TOO_SHORT"
  | "MODEL_CHANGED"
  | "HISTORY_MUTATED"
  | "UNKNOWN";

export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalPromptTokens: number;
}

export interface CacheDiagnosis {
  kind: CacheBreakKind;
  byteOffset: number | null;
  jsonPath: string | null;
  prevSnippet: string;
  currSnippet: string;
  summary: string;
  wastedUsd: number;
  cacheHitRate: number;
}

export interface TurnRecord {
  id: number;
  sessionId: string;
  turnIndex: number;
  timestampMs: number;
  provider: ProviderKind;
  endpoint: string;
  model: string;
  statusCode: number;
  latencyMs: number;
  healed: boolean;
  healChanges: string[];
  usage: TokenUsage;
  costUsd: number;
  diagnosis: CacheDiagnosis;
  rawRequestBody: string;
}

export interface SessionSummary {
  id: string;
  label: string;
  command: string | null;
  healed: boolean;
  createdAtMs: number;
  turnCount: number;
  avgCacheHitRate: number;
  totalCostUsd: number;
  totalWastedUsd: number;
  breakCount: number;
}

export interface ModelRates {
  inputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
  outputPer1M: number;
}
