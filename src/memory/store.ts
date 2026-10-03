// 기억 저장소 (SQLite, node:sqlite). 종류별로 수명이 다르고, 꺼내 쓰면 강해지고, 약해지면 잊힌다.
// 잊힌 기억은 지우지 않고 forgotten_at만 찍는다. 검색에서는 빠지고, 관전 모드의 "잊힌 기억"에 남는다.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { bigrams, mentions, overlap } from "./text.js";

export type MemoryKind = "scratch" | "episode" | "knowledge" | "person" | "pref" | "self" | "question" | "diary";
export const MEMORY_KINDS: readonly MemoryKind[] = ["scratch", "episode", "knowledge", "person", "pref", "self", "question", "diary"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 종류별 반감기. 꺼내 쓰면 시계가 다시 돈다. */
export const HALF_LIFE: Record<MemoryKind, number> = {
  scratch: 2 * HOUR,
  episode: 4 * DAY,
  knowledge: 45 * DAY,
  person: 180 * DAY,
  pref: 90 * DAY,
  self: 365 * DAY,
  question: 10 * DAY,
  diary: Infinity,
};

export const FORGET_BELOW = 0.04;
/** 같은 key에 사실을 덧붙일 때 content 길이 상한. 넘치면 오래된 사실부터 밀어낸다. */
const MAX_FACTS_LENGTH = 400;

export interface Memory {
  id: number;
  kind: MemoryKind;
  /** 사람 이름, 단어, 질문 대상. 없을 수 있다. */
  key: string | null;
  content: string;
  /** user(이 집 사람이 알려줌) | search(검색) | own(혼자 알아냄) | activity | self */
  source: string;
  importance: number;
  uses: number;
  createdAt: number;
  lastUsedAt: number;
  forgottenAt: number | null;
  topic: string | null;
  meta: Record<string, unknown>;
}

export interface NewMemory {
  kind: MemoryKind;
  key?: string | null;
  content: string;
  source: string;
  importance?: number;
  topic?: string | null;
  meta?: Record<string, unknown>;
}

export interface ScoredMemory extends Memory {
  score: number;
  strength: number;
}

interface Row {
  id: number;
  kind: string;
  key: string | null;
  content: string;
  source: string;
  importance: number;
  uses: number;
  created_at: number;
  last_used_at: number;
  forgotten_at: number | null;
  topic: string | null;
  meta: string;
}

function toMemory(row: Row): Memory {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    key: row.key,
    content: row.content,
    source: row.source,
    importance: row.importance,
    uses: row.uses,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    forgottenAt: row.forgotten_at,
    topic: row.topic,
    meta: JSON.parse(row.meta || "{}") as Record<string, unknown>,
  };
}

/** 지금 이 기억이 얼마나 생생한가 (0..1). */
export function strength(memory: Pick<Memory, "kind" | "importance" | "uses" | "lastUsedAt">, now: number): number {
  const halfLife = HALF_LIFE[memory.kind];
  const decay = Number.isFinite(halfLife) ? Math.pow(0.5, Math.max(0, now - memory.lastUsedAt) / halfLife) : 1;
  return Math.min(1, memory.importance * decay * (1 + 0.25 * Math.log1p(memory.uses)));
}

export class MemoryStore {
  readonly db: DatabaseSync;

  /** file이 ":memory:"면 메모리에만 둔다 (테스트). */
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        key TEXT,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        importance REAL NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        forgotten_at INTEGER,
        topic TEXT,
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS memories_kind_key ON memories(kind, key);
      CREATE TABLE IF NOT EXISTS topics (topic TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS topics_topic_at ON topics(topic, at);
      CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, layer TEXT NOT NULL, calls INTEGER NOT NULL, PRIMARY KEY (day, layer));
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  close() { this.db.close(); }

  add(input: NewMemory, now: number): Memory {
    const result = this.db.prepare(`
      INSERT INTO memories (kind, key, content, source, importance, uses, created_at, last_used_at, topic, meta)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(input.kind, input.key?.trim() || null, input.content.trim(), input.source, clamp01(input.importance ?? 0.5), now, now, input.topic ?? null, JSON.stringify(input.meta ?? {}));
    return this.get(Number(result.lastInsertRowid))!;
  }

  get(id: number): Memory | undefined {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Row | undefined;
    return row ? toMemory(row) : undefined;
  }

  /** key로 찾는다 (대소문자 무시). 잊힌 것은 includeForgotten일 때만. */
  findByKey(kinds: readonly MemoryKind[], key: string, includeForgotten = false): Memory | undefined {
    const rows = this.db.prepare(`
      SELECT * FROM memories WHERE kind IN (${kinds.map(() => "?").join(",")}) AND lower(key) = lower(?)
      ${includeForgotten ? "" : "AND forgotten_at IS NULL"} ORDER BY last_used_at DESC LIMIT 1
    `).all(...kinds, key.trim()) as unknown as Row[];
    return rows[0] ? toMemory(rows[0]) : undefined;
  }

  /**
   * 같은 key가 있으면 사실을 덧붙이고, 없으면 새로 만든다 (사람, 지식, 취향).
   * 이미 들어 있는 사실이면 강화만 한다.
   */
  upsertFact(input: NewMemory & { key: string }, now: number): { memory: Memory; created: boolean } {
    const existing = this.findByKey([input.kind], input.key);
    if (!existing) return { memory: this.add(input, now), created: true };
    const fact = input.content.trim();
    let content = existing.content;
    if (!overlapsFact(content, fact)) {
      const facts = [...content.split(" / "), fact];
      while (facts.join(" / ").length > MAX_FACTS_LENGTH && facts.length > 1) facts.shift();
      content = facts.join(" / ");
    }
    const meta = { ...existing.meta, ...input.meta };
    this.db.prepare(`
      UPDATE memories SET content = ?, importance = ?, uses = uses + 1, last_used_at = ?, meta = ?, topic = coalesce(?, topic) WHERE id = ?
    `).run(content, Math.max(existing.importance, clamp01(input.importance ?? 0.5)), now, JSON.stringify(meta), input.topic ?? null, existing.id);
    return { memory: this.get(existing.id)!, created: false };
  }

  /** 꺼내 썼다 → 강화. */
  touch(ids: readonly number[], now: number) {
    const statement = this.db.prepare("UPDATE memories SET uses = uses + 1, last_used_at = ? WHERE id = ?");
    for (const id of ids) statement.run(now, id);
  }

  forget(id: number, now: number) {
    this.db.prepare("UPDATE memories SET forgotten_at = ? WHERE id = ? AND forgotten_at IS NULL").run(now, id);
  }

  update(id: number, patch: { content?: string; meta?: Record<string, unknown>; importance?: number }) {
    const current = this.get(id);
    if (!current) return;
    this.db.prepare("UPDATE memories SET content = ?, meta = ?, importance = ? WHERE id = ?")
      .run(patch.content ?? current.content, JSON.stringify({ ...current.meta, ...patch.meta }), clamp01(patch.importance ?? current.importance), id);
  }

  list(options: { kinds?: readonly MemoryKind[]; includeForgotten?: boolean; onlyForgotten?: boolean; limit?: number } = {}): Memory[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.kinds?.length) {
      where.push(`kind IN (${options.kinds.map(() => "?").join(",")})`);
      params.push(...options.kinds);
    }
    if (options.onlyForgotten) where.push("forgotten_at IS NOT NULL");
    else if (!options.includeForgotten) where.push("forgotten_at IS NULL");
    const rows = this.db.prepare(`
      SELECT * FROM memories ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?
    `).all(...params, options.limit ?? 200) as unknown as Row[];
    return rows.map(toMemory);
  }

  /**
   * 관련 기억 검색. 점수 = (key 언급 + 드문 bigram 겹침 + 주제 일치) × (0.4 + 생생함).
   * bigram은 기억 전체에서 드물수록 무게가 크다 (IDF). "이 집 사람" 같은 흔한 말로는 안 걸린다.
   * 기억은 많아야 수천 개라 전부 훑는다.
   */
  search(query: string, now: number, options: { kinds?: readonly MemoryKind[]; limit?: number; minScore?: number; topic?: string | null } = {}): ScoredMemory[] {
    const kinds = options.kinds ?? MEMORY_KINDS.filter((kind) => kind !== "diary");
    const docs = this.list({ kinds, limit: 5000 }).map((memory) => ({ memory, grams: bigrams(`${memory.key ?? ""} ${memory.content}`) }));
    const df = new Map<string, number>();
    for (const doc of docs) for (const gram of doc.grams) df.set(gram, (df.get(gram) ?? 0) + 1);
    const n = docs.length;
    const idf = (gram: string) => Math.max(0, Math.log((n + 1) / ((df.get(gram) ?? 0) + 0.5)));
    // 드문 bigram 두 개가 겹치면 만점
    const norm = 2 * Math.log((n + 1) / 1.5) || 1;
    const grams = bigrams(query);
    const results: ScoredMemory[] = [];
    for (const { memory, grams: target } of docs) {
      let relevance = 0;
      if (memory.key && mentions(query, memory.key)) relevance += 1;
      let shared = 0;
      for (const gram of grams) if (target.has(gram)) shared += idf(gram);
      relevance += Math.min(1, shared / norm) * 0.8;
      if (options.topic && memory.topic === options.topic) relevance += 0.3;
      if (relevance <= 0) continue;
      const vivid = strength(memory, now);
      const score = relevance * (0.4 + vivid);
      if (score >= (options.minScore ?? 0.15)) results.push({ ...memory, score, strength: vivid });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 6);
  }

  /** 수면 중 정리: 약해진 기억을 잊는다. 잊은 목록을 돌려준다. */
  forgetWeak(now: number): Memory[] {
    const forgotten: Memory[] = [];
    for (const memory of this.list({ limit: 100_000 })) {
      if (memory.kind === "diary") continue;
      if (strength(memory, now) < FORGET_BELOW) {
        this.forget(memory.id, now);
        forgotten.push(memory);
      }
    }
    return forgotten;
  }

  // ── 주제 반복 (MECHANISMS §9) ──

  recordTopic(topic: string, at: number) {
    this.db.prepare("INSERT INTO topics (topic, at) VALUES (?, ?)").run(topic, at);
  }

  topicCount(topic: string, since: number): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM topics WHERE topic = ? AND at >= ?").get(topic, since) as { n: number };
    return row.n;
  }

  // ── 사용량 (예산과 체력) ──

  addUsage(day: string, layer: string) {
    this.db.prepare("INSERT INTO usage (day, layer, calls) VALUES (?, ?, 1) ON CONFLICT(day, layer) DO UPDATE SET calls = calls + 1").run(day, layer);
  }

  usage(day: string): Record<string, number> {
    const rows = this.db.prepare("SELECT layer, calls FROM usage WHERE day = ?").all(day) as unknown as { layer: string; calls: number }[];
    return Object.fromEntries(rows.map((row) => [row.layer, row.calls]));
  }

  // ── 작은 상태 값 (기분, 할 말 큐, 마지막 일기 날짜 …) ──

  getValue<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }

  setValue(key: string, value: unknown) {
    this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
  }
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

/** 이미 같은 말이 들어 있는가 (거의 같은 문장 포함). */
function overlapsFact(content: string, fact: string): boolean {
  if (content.includes(fact)) return true;
  return content.split(" / ").some((existing) => overlap(bigrams(fact), bigrams(existing)) > 0.85);
}
