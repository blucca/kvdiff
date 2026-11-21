import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CacheDiagnosis, ProviderKind, SessionSummary, TokenUsage, TurnRecord } from "./types.js";

interface RawTurnRow {
  id: number;
  session_id: string;
  turn_index: number;
  timestamp_ms: number;
  provider: string;
  endpoint: string;
  model: string;
  status_code: number;
  latency_ms: number;
  healed: number;
  heal_changes_json: string;
  usage_json: string;
  cost_usd: number;
  diagnosis_json: string;
  raw_request_body: string;
}

interface RawSessionAggRow {
  id: string;
  label: string;
  command: string | null;
  healed: number;
  created_at_ms: number;
  turn_count: number;
  avg_cache_hit_rate: number | null;
  total_cost_usd: number | null;
  total_wasted_usd: number | null;
  break_count: number | null;
}

export class KvStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        command TEXT,
        healed INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        provider TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        healed INTEGER NOT NULL DEFAULT 0,
        heal_changes_json TEXT NOT NULL,
        usage_json TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        cache_hit_rate REAL NOT NULL,
        wasted_usd REAL NOT NULL,
        break_kind TEXT NOT NULL,
        diagnosis_json TEXT NOT NULL,
        raw_request_body TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_turns_session_turn
        ON turns (session_id, turn_index);
    `);
  }

  createSession(meta: { id?: string; label: string; command?: string; healed: boolean; createdAtMs?: number }): SessionSummary {
    const id = meta.id ?? randomUUID().slice(0, 12);
    const createdAtMs = meta.createdAtMs ?? Date.now();
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, label, command, healed, created_at_ms) VALUES (?, ?, ?, ?, ?)")
      .run(id, meta.label, meta.command ?? null, meta.healed ? 1 : 0, createdAtMs);

    return {
      id,
      label: meta.label,
      command: meta.command ?? null,
      healed: meta.healed,
      createdAtMs,
      turnCount: 0,
      avgCacheHitRate: 0,
      totalCostUsd: 0,
      totalWastedUsd: 0,
      breakCount: 0,
    };
  }

  ensureSession(id: string, label: string, healed = false): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, label, command, healed, created_at_ms) VALUES (?, ?, NULL, ?, ?)")
      .run(id, label, healed ? 1 : 0, Date.now());
  }

  recordTurn(turn: Omit<TurnRecord, "id">): TurnRecord {
    this.ensureSession(turn.sessionId, turn.sessionId, turn.healed);
    const stmt = this.db.prepare(`
      INSERT INTO turns (
        session_id, turn_index, timestamp_ms, provider, endpoint, model,
        status_code, latency_ms, healed, heal_changes_json, usage_json,
        cost_usd, cache_hit_rate, wasted_usd, break_kind, diagnosis_json, raw_request_body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const res = stmt.run(
      turn.sessionId,
      turn.turnIndex,
      turn.timestampMs,
      turn.provider,
      turn.endpoint,
      turn.model,
      turn.statusCode,
      turn.latencyMs,
      turn.healed ? 1 : 0,
      JSON.stringify(turn.healChanges),
      JSON.stringify(turn.usage),
      turn.costUsd,
      turn.diagnosis.cacheHitRate,
      turn.diagnosis.wastedUsd,
      turn.diagnosis.kind,
      JSON.stringify(turn.diagnosis),
      turn.rawRequestBody
    );

    return {
      id: Number(res.lastInsertRowid),
      ...turn,
    };
  }

  listSessions(): SessionSummary[] {
    const rows = this.db
      .prepare(`
        SELECT
          s.id,
          s.label,
          s.command,
          s.healed,
          s.created_at_ms,
          COUNT(t.id) AS turn_count,
          AVG(CASE WHEN t.turn_index > 1 THEN t.cache_hit_rate END) AS avg_cache_hit_rate,
          SUM(t.cost_usd) AS total_cost_usd,
          SUM(t.wasted_usd) AS total_wasted_usd,
          SUM(CASE WHEN t.break_kind NOT IN ('NONE', 'FIRST_TURN') THEN 1 ELSE 0 END) AS break_count
        FROM sessions s
        LEFT JOIN turns t ON t.session_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at_ms DESC
      `)
      .all() as unknown as RawSessionAggRow[];

    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      command: r.command,
      healed: r.healed === 1,
      createdAtMs: r.created_at_ms,
      turnCount: Number(r.turn_count ?? 0),
      avgCacheHitRate: Number(r.avg_cache_hit_rate ?? 0),
      totalCostUsd: Number(r.total_cost_usd ?? 0),
      totalWastedUsd: Number(r.total_wasted_usd ?? 0),
      breakCount: Number(r.break_count ?? 0),
    }));
  }

  getSessionTurns(sessionId: string): TurnRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id, session_id, turn_index, timestamp_ms, provider, endpoint, model,
          status_code, latency_ms, healed, heal_changes_json, usage_json,
          cost_usd, diagnosis_json, raw_request_body
        FROM turns
        WHERE session_id = ?
        ORDER BY turn_index ASC, id ASC
      `)
      .all(sessionId) as unknown as RawTurnRow[];

    return rows.map(hydrateTurn);
  }

  getLastTurn(sessionId: string): TurnRecord | null {
    const row = this.db
      .prepare(`
        SELECT
          id, session_id, turn_index, timestamp_ms, provider, endpoint, model,
          status_code, latency_ms, healed, heal_changes_json, usage_json,
          cost_usd, diagnosis_json, raw_request_body
        FROM turns
        WHERE session_id = ?
        ORDER BY turn_index DESC, id DESC
        LIMIT 1
      `)
      .get(sessionId) as unknown as RawTurnRow | undefined;

    return row ? hydrateTurn(row) : null;
  }

  close(): void {
    this.db.close();
  }
}

function hydrateTurn(row: RawTurnRow): TurnRecord {
  return {
    id: Number(row.id),
    sessionId: row.session_id,
    turnIndex: Number(row.turn_index),
    timestampMs: Number(row.timestamp_ms),
    provider: row.provider as ProviderKind,
    endpoint: row.endpoint,
    model: row.model,
    statusCode: Number(row.status_code),
    latencyMs: Number(row.latency_ms),
    healed: row.healed === 1,
    healChanges: JSON.parse(row.heal_changes_json) as string[],
    usage: JSON.parse(row.usage_json) as TokenUsage,
    costUsd: Number(row.cost_usd),
    diagnosis: JSON.parse(row.diagnosis_json) as CacheDiagnosis,
    rawRequestBody: row.raw_request_body,
  };
}
