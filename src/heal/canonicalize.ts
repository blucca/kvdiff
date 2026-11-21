import type { ProviderKind } from "../types.js";

function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    // NEVER reorder arrays (preserves enum[], required[], anyOf[], etc.)
    return value.map(sortObjectKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
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
  if (rec.function && typeof rec.function === "object" && typeof (rec.function as Record<string, unknown>).name === "string") {
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
    if (provider === "gemini") {
      let sortedCount = 0;
      root.tools = root.tools.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const block = { ...(entry as Record<string, unknown>) };
        if (Array.isArray(block.functionDeclarations)) {
          const before = JSON.stringify(block.functionDeclarations);
          const canonicalDecls = [...block.functionDeclarations]
            .map(sortObjectKeysDeep)
            .sort((a, b) => getToolSortKey(a).localeCompare(getToolSortKey(b)));
          if (JSON.stringify(canonicalDecls) !== before) {
            sortedCount += canonicalDecls.length;
          }
          block.functionDeclarations = canonicalDecls;
        }
        return sortObjectKeysDeep(block);
      });
      if (sortedCount > 0) {
        changes.push(`canonicalized ${sortedCount} Gemini functionDeclarations`);
      }
    } else {
      const before = JSON.stringify(root.tools);
      const canonicalTools = [...root.tools]
        .map(sortObjectKeysDeep)
        .sort((a, b) => getToolSortKey(a).localeCompare(getToolSortKey(b)));
      if (JSON.stringify(canonicalTools) !== before) {
        root.tools = canonicalTools;
        changes.push(`canonicalized ${canonicalTools.length} tools and schema keys`);
      }
    }
  }

  if (changes.length === 0) {
    return { body: rawBody, changes: [] };
  }

  return {
    body: Buffer.from(JSON.stringify(root), "utf8"),
    changes,
  };
}
