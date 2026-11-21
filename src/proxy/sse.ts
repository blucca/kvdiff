import { StringDecoder } from "node:string_decoder";

export class SseTeeParser {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private readonly events: unknown[] = [];

  push(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    this.drainCompleteFrames();
  }

  finish(): unknown[] {
    this.buffer += this.decoder.end();
    this.drainCompleteFrames();
    if (this.buffer.trim().length > 0) {
      this.parseFrame(this.buffer);
      this.buffer = "";
    }
    return this.events;
  }

  private drainCompleteFrames(): void {
    let match: RegExpExecArray | null;
    const sep = /\r?\n\r?\n/;
    while ((match = sep.exec(this.buffer)) !== null) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.parseFrame(frame);
    }
  }

  private parseFrame(frame: string): void {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;
    const joined = dataLines.join("\n").trim();
    if (!joined || joined === "[DONE]") return;
    try {
      this.events.push(JSON.parse(joined));
    } catch {
      // Ignore partial or non-JSON keepalive data frames
    }
  }
}
