import type { ProviderKind } from "../types.js";

function compareCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    // NEVER reorder arrays (preserves enum[], required[], anyOf[], etc.)
    return value.map(sortObjectKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareCodeUnit)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

function getToolSortKey(tool: unknown): string {
  if (!tool || typeof tool !== "object") return "";
  const rec = tool as Record<string, unknown>;
  if (typeof rec.name === "string") return rec.name;
  if (
    rec.function &&
    typeof rec.function === "object" &&
    typeof (rec.function as Record<string, unknown>).name === "string"
  ) {
    return (rec.function as Record<string, unknown>).name as string;
  }
  return "";
}

export function healRequestPayload(
  provider: ProviderKind,
  rawBody: Buffer
): { body: Buffer; changes: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { body: rawBody, changes: [] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { body: rawBody, changes: [] };
  }

  const root = parsed as Record<string, unknown>;
  const changes: string[] = [];

  if (Array.isArray(root.tools) && root.tools.length > 0) {
    const toolsArr = root.tools;
    if (provider === "gemini") {
      const beforeTools = JSON.stringify(toolsArr);
      let declCount = 0;
      root.tools = toolsArr.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const block = { ...(entry as Record<string, unknown>) };
        if (Array.isArray(block.functionDeclarations)) {
          const canonicalDecls = [...block.functionDeclarations]
            .map(sortObjectKeysDeep)
            .sort((a, b) => compareCodeUnit(getToolSortKey(a), getToolSortKey(b)));
          declCount += canonicalDecls.length;
          block.functionDeclarations = canonicalDecls;
        }
        return sortObjectKeysDeep(block);
      });
      if (JSON.stringify(root.tools) !== beforeTools) {
        changes.push(`canonicalized ${declCount || toolsArr.length} Gemini tool definitions`);
      }
    } else {
      const beforeTools = JSON.stringify(toolsArr);
      // Preserve trailing Anthropic cache_control breakpoint on the final sorted tool
      let trailingCacheControl: unknown = undefined;
      const strippedTools = toolsArr.map((t, idx) => {
        if (
          provider === "anthropic" &&
          idx === toolsArr.length - 1 &&
          t &&
          typeof t === "object" &&
          "cache_control" in (t as Record<string, unknown>)
        ) {
          const copy = { ...(t as Record<string, unknown>) };
          trailingCacheControl = copy.cache_control;
          delete copy.cache_control;
          return copy;
        }
        return t;
      });

      const canonicalTools = strippedTools
        .map(sortObjectKeysDeep)
        .sort((a, b) => compareCodeUnit(getToolSortKey(a), getToolSortKey(b)));

      if (trailingCacheControl !== undefined && canonicalTools.length > 0) {
        const lastIdx = canonicalTools.length - 1;
        const lastTool = canonicalTools[lastIdx];
        if (lastTool && typeof lastTool === "object" && !Array.isArray(lastTool)) {
          canonicalTools[lastIdx] = sortObjectKeysDeep({
            ...(lastTool as Record<string, unknown>),
            cache_control: trailingCacheControl,
          });
        }
      }

      root.tools = canonicalTools;
      if (JSON.stringify(canonicalTools) !== beforeTools) {
        changes.push(`canonicalized ${canonicalTools.length} tools and schema keys`);
      }
    }
  }

  // Always emit compact canonical JSON under --heal when bytes differ (prevents Turn 1 compact vs Turn 2 pretty mismatch)
  const serialized = Buffer.from(JSON.stringify(root), "utf8");
  if (!serialized.equals(rawBody)) {
    if (changes.length === 0) {
      changes.push("normalized JSON whitespace for deterministic prefix");
    }
    return { body: serialized, changes };
  }

  return { body: rawBody, changes: [] };
}
