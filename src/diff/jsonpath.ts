type Frame =
  | { kind: "object"; expect: "key" | "colon" | "value" | "comma"; currentKey: string | null }
  | { kind: "array"; expect: "value" | "comma"; index: number };

const BYTE_SPACE = 0x20;
const BYTE_TAB = 0x09;
const BYTE_LF = 0x0a;
const BYTE_CR = 0x0d;
const BYTE_QUOTE = 0x22;
const BYTE_BACKSLASH = 0x5c;
const BYTE_LBRACE = 0x7b;
const BYTE_RBRACE = 0x7d;
const BYTE_LBRACKET = 0x5b;
const BYTE_RBRACKET = 0x5d;
const BYTE_COLON = 0x3a;
const BYTE_COMMA = 0x2c;

function isWhitespace(b: number): boolean {
  return b === BYTE_SPACE || b === BYTE_TAB || b === BYTE_LF || b === BYTE_CR;
}

function formatStack(stack: Frame[]): string {
  let out = "$";
  for (const frame of stack) {
    if (frame.kind === "object") {
      if (frame.currentKey !== null) {
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(frame.currentKey)) {
          out += `.${frame.currentKey}`;
        } else {
          out += `[${JSON.stringify(frame.currentKey)}]`;
        }
      }
    } else {
      out += `[${frame.index}]`;
    }
  }
  return out;
}

function readJsonString(buf: Buffer, startQuoteIdx: number): { value: string; endIdx: number } {
  let i = startQuoteIdx + 1;
  while (i < buf.length) {
    const b = buf[i];
    if (b === BYTE_BACKSLASH) {
      i += 2;
      continue;
    }
    if (b === BYTE_QUOTE) {
      const raw = buf.subarray(startQuoteIdx, i + 1).toString("utf8");
      try {
        return { value: JSON.parse(raw) as string, endIdx: i };
      } catch {
        return { value: buf.subarray(startQuoteIdx + 1, i).toString("utf8"), endIdx: i };
      }
    }
    i++;
  }
  return { value: buf.subarray(startQuoteIdx + 1).toString("utf8"), endIdx: buf.length - 1 };
}

export function byteOffsetToJsonPath(buf: Buffer, targetByteOffset: number): string | null {
  if (buf.length === 0 || targetByteOffset < 0) return null;
  const clampedTarget = Math.min(targetByteOffset, buf.length - 1);

  const stack: Frame[] = [];
  let i = 0;

  while (i < buf.length) {
    while (i < buf.length && isWhitespace(buf[i])) {
      i++;
    }
    if (i >= buf.length) break;

    const b = buf[i];
    const top = stack[stack.length - 1];

    if (b === BYTE_LBRACE) {
      if (i >= clampedTarget) return formatStack(stack);
      stack.push({ kind: "object", expect: "key", currentKey: null });
      i++;
      continue;
    }

    if (b === BYTE_RBRACE) {
      if (i >= clampedTarget) return formatStack(stack);
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent?.kind === "object" && parent.expect === "value") parent.expect = "comma";
      else if (parent?.kind === "array" && parent.expect === "value") parent.expect = "comma";
      i++;
      continue;
    }

    if (b === BYTE_LBRACKET) {
      if (i >= clampedTarget) return formatStack(stack);
      stack.push({ kind: "array", expect: "value", index: 0 });
      i++;
      continue;
    }

    if (b === BYTE_RBRACKET) {
      if (i >= clampedTarget) return formatStack(stack);
      stack.pop();
      const parent = stack[stack.length - 1];
      if (parent?.kind === "object" && parent.expect === "value") parent.expect = "comma";
      else if (parent?.kind === "array" && parent.expect === "value") parent.expect = "comma";
      i++;
      continue;
    }

    if (b === BYTE_COLON) {
      if (top?.kind === "object") {
        top.expect = "value";
      }
      if (i >= clampedTarget) return formatStack(stack);
      i++;
      continue;
    }

    if (b === BYTE_COMMA) {
      if (top?.kind === "object") {
        top.expect = "key";
        top.currentKey = null;
      } else if (top?.kind === "array") {
        top.index += 1;
        top.expect = "value";
      }
      if (i >= clampedTarget) return formatStack(stack);
      i++;
      continue;
    }

    if (b === BYTE_QUOTE) {
      const { value, endIdx } = readJsonString(buf, i);
      if (top?.kind === "object" && top.expect === "key") {
        top.currentKey = value;
        top.expect = "colon";
        if (clampedTarget >= i && clampedTarget <= endIdx) {
          return formatStack(stack);
        }
      } else {
        if (clampedTarget >= i && clampedTarget <= endIdx) {
          return formatStack(stack);
        }
        if (top?.kind === "object" && top.expect === "value") top.expect = "comma";
        else if (top?.kind === "array" && top.expect === "value") top.expect = "comma";
      }
      i = endIdx + 1;
      continue;
    }

    // Primitive literal (number, true, false, null)
    const primStart = i;
    while (
      i < buf.length &&
      !isWhitespace(buf[i]) &&
      buf[i] !== BYTE_COMMA &&
      buf[i] !== BYTE_RBRACE &&
      buf[i] !== BYTE_RBRACKET
    ) {
      i++;
    }
    const primEnd = i - 1;
    if (clampedTarget >= primStart && clampedTarget <= primEnd) {
      return formatStack(stack);
    }
    if (top?.kind === "object" && top.expect === "value") top.expect = "comma";
    else if (top?.kind === "array" && top.expect === "value") top.expect = "comma";
  }

  return stack.length > 0 ? formatStack(stack) : "$";
}
