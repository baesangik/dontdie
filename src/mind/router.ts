// Router (무의식). 가장 싼 모델로 매 메시지를 판정한다. 말하지 않는다.
// 실패하거나 JSON이 깨지면 규칙 기반 판정으로 넘어간다. 대화는 멈추지 않는다.

import type { Language, LayerConfig } from "../config.js";
import { loadPrompt } from "../prompts.js";
import { asProviderError, extractJson, type Provider } from "../providers/types.js";
import { ruleVerdict } from "./rules.js";
import { sanitizeVerdict, VERDICT_SCHEMA, type Verdict } from "./verdict.js";

export interface RouterInput {
  language: Language;
  /** 이번에 판정할 메시지 (여러 개면 줄바꿈으로 이어 붙인다) */
  text: string;
  /** 최근 대화, 오래된 것부터 */
  recent: { who: "person" | "me"; text: string }[];
  characterName?: string | undefined;
  addressAs?: string | undefined;
  /** 이미 아는 이름과 단어 (기억의 key) */
  knownKeys: string[];
  /** 물어보고 답을 기다리는 것 */
  openQuestions: { term: string; kind: string }[];
}

export interface RouterResult {
  verdict: Verdict;
  ms: number;
  /** 규칙으로 넘어간 이유. LLM 판정이면 없다. */
  fallback?: string;
}

export function routerMessage(input: RouterInput): string {
  const lines = [
    `Conversation language: ${input.language}`,
    `Creature's name here: ${input.characterName ?? "(none yet)"}`,
    `What the creature calls the person: ${input.addressAs ?? "(nothing yet)"}`,
    `Already knows: ${input.knownKeys.length ? input.knownKeys.slice(0, 60).join(", ") : "(nothing yet)"}`,
    `Open questions the creature asked and is waiting on: ${input.openQuestions.length ? input.openQuestions.map((entry) => `${entry.term} (${entry.kind})`).join(", ") : "(none)"}`,
    "",
    "Recent conversation (oldest first):",
    ...(input.recent.length ? input.recent.map((turn) => `${turn.who === "me" ? "creature" : "person"}: ${turn.text}`) : ["(none)"]),
    "",
    "NEW message from the person:",
    input.text,
  ];
  return lines.join("\n");
}

export async function runRouter(input: RouterInput, layer: LayerConfig, provider: Provider, signal?: AbortSignal): Promise<RouterResult> {
  const started = Date.now();
  try {
    // 스트림이 끊기는 등 일시적인 실패는 한 번 더 해본다. 판정을 놓치면 배운 것도 놓친다.
    const generate = () => provider.generate({
      purpose: "router",
      model: layer.model,
      instructions: loadPrompt("router"),
      messages: [{ role: "user", content: routerMessage(input) }],
      ...(layer.effort ? { effort: layer.effort } : {}),
      json: { name: "verdict", schema: VERDICT_SCHEMA as unknown as Record<string, unknown> },
      maxOutputTokens: 1500,
      ...(signal ? { signal } : {}),
    });
    const { text } = await generate().catch((error: unknown) => {
      if (asProviderError(error).retryable && !signal?.aborted) return generate();
      throw error;
    });
    const verdict = sanitizeVerdict(extractJson(text));
    // 규칙이 더 잘 잡는 것: 출처 힌트 ("디시에 쳐봐")
    if (verdict.search.requested && !verdict.search.hint) verdict.search.hint = ruleVerdict(input.text, input.language).search.hint;
    return { verdict, ms: Date.now() - started };
  } catch (error) {
    return { verdict: ruleVerdict(input.text, input.language), ms: Date.now() - started, fallback: asProviderError(error).code };
  }
}
