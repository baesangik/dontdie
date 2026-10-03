// Reasoner (외장 뇌). 검색과 깊은 고민을 맡는다. 사용자에게 직접 말하지 않고, 말투 없는 노트만 돌려준다.
// Talker가 그 노트를 자기 말투로 바꾼다. 그래서 "GPT식 브리핑"이 새어 나가지 않는다.

import type { Language, LayerConfig } from "../config.js";
import { loadPrompt } from "../prompts.js";
import { extractJson, type Citation, type Provider } from "../providers/types.js";

export interface LookupTask {
  kind: "lookup";
  query: string;
  /** 이 집 사람이 말한 출처 ("dcinside") */
  hint: string | null;
  /** 왜 찾는가 (모르는 단어가 나온 문장 등) */
  context: string;
}

export interface ThinkTask {
  kind: "think";
  /** 고민할 문제 (이 집 사람이 한 말) */
  question: string;
  /** 반사적으로 이미 한 말. 없으면 null */
  reflex: string | null;
  /** 이 집 사람에 대해 아는 것, 최근 대화 */
  context: string;
  critical: boolean;
}

export type ReasonerTask = LookupTask | ThinkTask;

export interface LookupNote {
  kind: "lookup";
  query: string;
  hint: string | null;
  found: boolean;
  answer: string;
  confidence: number;
  sources: Citation[];
  /** 실제로 웹 검색을 쓸 수 있었나 */
  searched: boolean;
}

export interface ThinkNote {
  kind: "think";
  question: string;
  reflex: string | null;
  conclusion: string;
  agrees: boolean | null;
  reasons: string[];
  confidence: number;
  caution: string | null;
}

export type ReasonerNote = LookupNote | ThinkNote;

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

const LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "answer", "confidence", "sources"],
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    confidence: { type: "number", description: "0..1" },
    sources: { type: "array", items: { type: "string" } },
  },
};

const THINK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["conclusion", "agreesWithReflex", "reasons", "confidence", "caution"],
  properties: {
    conclusion: { type: "string" },
    agreesWithReflex: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    reasons: { type: "array", items: { type: "string" } },
    confidence: { type: "number", description: "0..1" },
    caution: nullableString,
  },
};

export function reasonerMessage(task: ReasonerTask, language: Language): string {
  if (task.kind === "lookup") {
    return [
      `Conversation language: ${language}`,
      "Task: look this up.",
      `Query: ${task.query}`,
      `Source the person suggested: ${task.hint ?? "(none)"}`,
      `Why: ${task.context}`,
    ].join("\n");
  }
  return [
    `Conversation language: ${language}`,
    `Task: think this through${task.critical ? " carefully. This touches health, money, law, or safety." : "."}`,
    `The person said: ${task.question}`,
    `The creature's quick answer: ${task.reflex ?? "(none yet)"}`,
    "",
    "Context:",
    task.context || "(none)",
  ].join("\n");
}

export async function runReasoner(task: ReasonerTask, options: { layer: LayerConfig; provider: Provider; language: Language; signal?: AbortSignal }): Promise<ReasonerNote> {
  const lookup = task.kind === "lookup";
  const effort = lookup ? "low" : task.critical ? "high" : options.layer.effort;
  const result = await options.provider.generate({
    purpose: "reasoner",
    model: options.layer.model,
    instructions: loadPrompt("reasoner"),
    messages: [{ role: "user", content: reasonerMessage(task, options.language) }],
    ...(effort ? { effort } : {}),
    json: lookup ? { name: "lookup_note", schema: LOOKUP_SCHEMA } : { name: "think_note", schema: THINK_SCHEMA },
    webSearch: lookup,
    maxOutputTokens: 6000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const raw = extractJson(result.text) as Record<string, unknown>;
  const confidence = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  if (task.kind === "lookup") {
    const urls = Array.isArray(raw.sources) ? raw.sources.filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url)) : [];
    const sources = new Map<string, Citation>();
    for (const citation of [...(result.citations ?? []), ...urls.map((url) => ({ url }))].map(cleanCitation)) {
      if (!sources.has(citation.url)) sources.set(citation.url, citation);
    }
    const answer = typeof raw.answer === "string" ? stripCitations(raw.answer) : "";
    return {
      kind: "lookup",
      query: task.query,
      hint: task.hint,
      found: raw.found === true && answer.length > 0,
      answer,
      confidence,
      sources: [...sources.values()].slice(0, 3),
      searched: !result.webSearchUnavailable,
    };
  }
  return {
    kind: "think",
    question: task.question,
    reflex: task.reflex,
    conclusion: typeof raw.conclusion === "string" ? raw.conclusion.trim() : "",
    agrees: typeof raw.agreesWithReflex === "boolean" ? raw.agreesWithReflex : null,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 3) : [],
    confidence,
    caution: typeof raw.caution === "string" && raw.caution.trim() ? raw.caution.trim() : null,
  };
}

/** 본문에 섞인 마크다운 인용 "([site](url))", "[text](url)", 맨 URL을 걷어낸다. 출처는 sources에 따로 있다. */
export function stripCitations(text: string): string {
  return text
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*\(?https?:\/\/\S+\)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 추적용 쿼리 파라미터(utm_*)를 걷어낸다. */
function cleanCitation(citation: Citation): Citation {
  try {
    const url = new URL(citation.url);
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|trk)/.test(key)) url.searchParams.delete(key);
    return { ...citation, url: url.toString() };
  } catch {
    return citation;
  }
}
