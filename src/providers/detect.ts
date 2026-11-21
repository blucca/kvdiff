import type { ProviderKind } from "../types.js";

export function detectProvider(
  urlPath: string,
  headers: Record<string, string | string[] | undefined>,
  isLocalUpstream: boolean
): ProviderKind {
  const cleanPath = urlPath.split("?")[0] || "/";

  if (cleanPath.startsWith("/v1/messages") || headers["anthropic-version"] !== undefined) {
    return "anthropic";
  }

  if (
    /^\/v1(?:beta)?\/models\/[^/]+:(?:streamGenerateContent|generateContent)/i.test(cleanPath) ||
    headers["x-goog-api-key"] !== undefined
  ) {
    return "gemini";
  }

  if (isLocalUpstream) {
    return "local-openai";
  }

  return "openai";
}
