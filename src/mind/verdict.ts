// Router(무의식)의 판정. Router는 말하지 않고 이것만 돌려준다.

export const INTENTS = ["chat", "question", "request", "greeting", "farewell", "ack", "tease", "naming", "teaching", "scold", "other"] as const;
export const STAKES = ["low", "high", "critical"] as const;
export const TERM_KINDS = ["person", "place", "slang", "event", "thing", "other"] as const;
export const TEACHING_KINDS = [...TERM_KINDS, "pref"] as const;
export const PRESSURES = ["none", "scoff", "insist"] as const;

export type Intent = (typeof INTENTS)[number];
export type Stakes = (typeof STAKES)[number];
export type TermKind = (typeof TERM_KINDS)[number];
export type TeachingKind = (typeof TEACHING_KINDS)[number];
export type Pressure = (typeof PRESSURES)[number];

export interface UnknownTerm {
  term: string;
  kind: TermKind;
  /** 모델이 스스로 얼마나 확실히 아는가 (0..1) */
  known: number;
  guess: string | null;
}

export interface Teaching {
  term: string;
  kind: TeachingKind;
  /** 캐릭터 입장의 3인칭 사실 ("이 집 사람의 회사 동기") */
  fact: string;
}

export interface Verdict {
  salience: number;
  /** 감정 자극 (delta). valence -1..1, arousal 0..1 */
  valence: number;
  arousal: number;
  /** 지배적인 감정 한 단어 ("민망", "신남") */
  feeling: string | null;
  intent: Intent;
  /** 대화가 끝났을 가능성 0..1 */
  closure: number;
  leaving: boolean;
  stakes: Stakes;
  unknowns: UnknownTerm[];
  teaching: Teaching[];
  pressure: Pressure;
  /** 이 집 사람이 찾아보라고 했다 */
  search: { requested: boolean; query: string | null; hint: string | null };
  topic: string | null;
  /** 기억할 만한 일의 한 줄 요약 */
  gist: string | null;
  importance: number;
  /** 누가 판정했나: LLM 또는 규칙 */
  source: "llm" | "rules";
}

/** 판정할 게 없을 때 (데려온 직후 등) */
export function neutralVerdict(): Verdict {
  return {
    salience: 0.5, valence: 0, arousal: 0.3, feeling: null, intent: "other", closure: 0, leaving: false, stakes: "low",
    unknowns: [], teaching: [], pressure: "none", search: { requested: false, query: null, hint: null },
    topic: null, gist: null, importance: 0, source: "rules",
  };
}

// 범위 제약(minimum/maximum)은 Provider마다 지원이 달라서 넣지 않고, sanitizeVerdict에서 맞춘다.
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const unit = { type: "number", description: "0..1" };

/** Router 구조화 출력 스키마 (strict). */
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["salience", "valence", "arousal", "feeling", "intent", "closure", "leaving", "stakes", "unknowns", "teaching", "pressure", "search", "topic", "gist", "importance"],
  properties: {
    salience: unit,
    valence: { type: "number", description: "-1..1" },
    arousal: unit,
    feeling: nullableString,
    intent: { type: "string", enum: INTENTS },
    closure: unit,
    leaving: { type: "boolean" },
    stakes: { type: "string", enum: STAKES },
    unknowns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "kind", "known", "guess"],
        properties: { term: { type: "string" }, kind: { type: "string", enum: TERM_KINDS }, known: unit, guess: nullableString },
      },
    },
    teaching: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "kind", "fact"],
        properties: { term: { type: "string" }, kind: { type: "string", enum: TEACHING_KINDS }, fact: { type: "string" } },
      },
    },
    pressure: { type: "string", enum: PRESSURES },
    search: {
      type: "object",
      additionalProperties: false,
      required: ["requested", "query", "hint"],
      properties: { requested: { type: "boolean" }, query: nullableString, hint: nullableString },
    },
    topic: nullableString,
    gist: nullableString,
    importance: unit,
  },
} as const;

/** LLM이 돌려준 값을 검증하고 범위를 맞춘다. 이상한 값은 기본값으로. */
export function sanitizeVerdict(raw: unknown): Verdict {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const num = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const str = (value: unknown, max = 200) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? value as T : fallback);
  const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, 6) : []) as Record<string, unknown>[];
  const search = (typeof input.search === "object" && input.search !== null ? input.search : {}) as Record<string, unknown>;
  return {
    salience: num(input.salience, 0, 1, 0.5),
    valence: num(input.valence, -1, 1, 0),
    arousal: num(input.arousal, 0, 1, 0.3),
    feeling: str(input.feeling, 20),
    intent: pick(input.intent, INTENTS, "other"),
    closure: num(input.closure, 0, 1, 0.1),
    leaving: input.leaving === true,
    stakes: pick(input.stakes, STAKES, "low"),
    unknowns: list(input.unknowns)
      .map((entry) => ({ term: str(entry?.term, 60), kind: pick(entry?.kind, TERM_KINDS, "other"), known: num(entry?.known, 0, 1, 0.5), guess: str(entry?.guess) }))
      .filter((entry): entry is UnknownTerm => Boolean(entry.term)),
    teaching: list(input.teaching)
      .map((entry) => ({ term: str(entry?.term, 60), kind: pick(entry?.kind, TEACHING_KINDS, "other"), fact: str(entry?.fact, 300) }))
      .filter((entry): entry is Teaching => Boolean(entry.term && entry.fact)),
    pressure: pick(input.pressure, PRESSURES, "none"),
    search: { requested: search.requested === true, query: str(search.query), hint: str(search.hint, 40) },
    topic: str(input.topic, 40),
    gist: str(input.gist, 200),
    importance: num(input.importance, 0, 1, 0),
    source: "llm",
  };
}
