import type { SessionSummary, TurnRecord } from "../../src/types.js";

export type { SessionSummary, TurnRecord };

export async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/__kvdiff/api/sessions");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SessionSummary[];
}

export async function fetchSessionTurns(sessionId: string): Promise<TurnRecord[]> {
  const res = await fetch(`/__kvdiff/api/sessions/${encodeURIComponent(sessionId)}/turns`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as TurnRecord[];
}

export function subscribeEvents(onTurn: () => void): () => void {
  const es = new EventSource("/__kvdiff/api/events");
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as { type?: string };
      if (data.type === "turn") onTurn();
    } catch {
      // ignore keepalives
    }
  };
  return () => es.close();
}
