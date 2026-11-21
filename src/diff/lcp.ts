export interface ByteLcpResult {
  byteOffset: number | null;
  prevSnippet: string;
  currSnippet: string;
}

const CONTEXT_BEFORE = 48;
const CONTEXT_AFTER = 96;

function sliceUtf8Safe(buf: Buffer, center: number): string {
  let start = Math.max(0, center - CONTEXT_BEFORE);
  let end = Math.min(buf.length, center + CONTEXT_AFTER);

  // Advance start past any UTF-8 continuation bytes (10xxxxxx)
  while (start < end && (buf[start] & 0xc0) === 0x80) {
    start++;
  }
  // Pull end back if it splits a multi-byte UTF-8 sequence
  while (end > start && end < buf.length && (buf[end] & 0xc0) === 0x80) {
    end--;
  }
  return buf.subarray(start, end).toString("utf8");
}

export function findByteLcp(prev: Buffer, curr: Buffer): ByteLcpResult {
  const minLen = Math.min(prev.length, curr.length);
  let diffOffset = -1;

  for (let i = 0; i < minLen; i++) {
    if (prev[i] !== curr[i]) {
      diffOffset = i;
      break;
    }
  }

  if (diffOffset === -1) {
    if (prev.length === curr.length) {
      return { byteOffset: null, prevSnippet: "", currSnippet: "" };
    }
    diffOffset = minLen;
  }

  return {
    byteOffset: diffOffset,
    prevSnippet: sliceUtf8Safe(prev, diffOffset),
    currSnippet: sliceUtf8Safe(curr, diffOffset),
  };
}
