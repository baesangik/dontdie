// Talker (자아). 존재 규칙 + 대화 + "[지금]" 블록으로 부르고, 출력에서 말풍선, 속생각, 태그를 꺼낸다.

import type { Language, LayerConfig } from "../config.js";
import { dayCount, type CharacterState } from "../character/state.js";
import { loadPrompt, renderTemplate } from "../prompts.js";
import type { ChatMessage, Provider } from "../providers/types.js";

export { renderTemplate };

export const MAX_BUBBLES = 4;
export const FACES = ["neutral", "happy", "sad", "surprised", "embarrassed", "annoyed", "thinking", "sleepy"] as const;
export type Face = (typeof FACES)[number];

export interface TalkerOutput {
  thought?: string;
  bubbles: string[];
  face?: Face;
  acceptName?: string;
  refuseName?: string;
  acceptAddress?: string;
  refuseAddress?: string;
  /** 찾아보기로 했다 (Reasoner lookup) */
  consult?: string;
  /** 나중에 혼자 찾아볼 궁금증 */
  later?: string;
  /** 나중에 이 집 사람한테 할 말 (혼자 있을 때) */
  tells: string[];
}

const PART_OF_DAY: Record<Language, [number, string][]> = {
  ko: [[5, "새벽"], [9, "아침"], [12, "오전"], [14, "점심"], [18, "오후"], [21, "저녁"], [24, "밤"]],
  en: [[5, "late night"], [9, "morning"], [12, "late morning"], [14, "midday"], [18, "afternoon"], [21, "evening"], [24, "night"]],
};

export function partOfDay(now: number, language: Language): string {
  const hour = new Date(now).getHours();
  return PART_OF_DAY[language].find(([until]) => hour < until)?.[1] ?? "";
}

export function describeNow(now: number, language: Language, character: CharacterState): string {
  const stamp = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { dateStyle: "full", timeStyle: "short" }).format(new Date(now));
  const day = dayCount(character, now);
  const part = partOfDay(now, language);
  return language === "ko" ? `${stamp} (${part}). 이 집에 온 지 ${day}일째.` : `${stamp} (${part}). Day ${day} in this house.`;
}

/** 지시문: 존재 규칙 + 출력 형식. 이름과 호칭이 바뀔 때만 달라지므로 프롬프트 캐시를 탄다. */
export function buildInstructions(language: Language, character: CharacterState): string {
  const values = { name: character.name?.value, address_as: character.addressAs?.value };
  return `${renderTemplate(loadPrompt("charter", language), values)}\n\n${renderTemplate(loadPrompt("format", language), values)}`;
}

const TAG = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i");

export function parseTalker(raw: string): TalkerOutput {
  let text = raw.replace(/\r/g, "");
  const output: TalkerOutput = { bubbles: [], tells: [] };

  const think = TAG("think").exec(text);
  if (think) {
    output.thought = think[1]!.trim() || undefined;
    text = text.replace(think[0], "");
  } else if (/^\s*<think>/i.test(text)) {
    // 닫는 태그를 빼먹었으면 첫 줄을 속생각으로 본다.
    const [first, ...rest] = text.replace(/^\s*<think>/i, "").split("\n");
    output.thought = first?.trim() || undefined;
    text = rest.join("\n");
  }

  const take = (name: string) => {
    const match = TAG(name).exec(text);
    if (!match) return undefined;
    text = text.replace(match[0], "");
    return match[1]!.trim() || undefined;
  };
  // 모델이 <face=happy>, <face:happy> 처럼 쓰기도 한다.
  let face = take("face")?.toLowerCase();
  const loose = /<face\s*[=:]\s*["']?([a-z]+)["']?\s*\/?>/i.exec(text);
  if (loose) {
    face ??= loose[1]!.toLowerCase();
    text = text.replace(loose[0], "");
  }
  if (FACES.includes(face as Face)) output.face = face as Face;
  const fields = { acceptName: "name", refuseName: "refuse_name", acceptAddress: "address", refuseAddress: "refuse_address", consult: "consult", later: "later" } as const;
  for (const [field, tag] of Object.entries(fields) as [keyof typeof fields, string][]) {
    const value = take(tag);
    if (value) output[field] = value;
  }
  for (let tell = take("tell"); tell; tell = take("tell")) output.tells.push(tell);

  output.bubbles = text
    // 남은 태그는 전부 지운다 (<foo>, </foo>, <foo=bar>, <foo/>)
    .replace(/<\/?[a-z_]+(\s*[=:][^>]*|\s+[^>]*)?\s*\/?>/gi, "")
    .split("\n")
    .map((line) => line.trim().replace(/^([-*•]|\d+[.)])\s+/, "").replace(/^\*\*(.*)\*\*$/, "$1").trim())
    .filter((line) => line && !/^["'“”]+$/.test(line))
    .slice(0, MAX_BUBBLES);
  return output;
}

/** 이전 턴을 다시 넣을 때의 형식. 속생각을 같이 넣어서 출력 형식을 유지시킨다. */
export function formatAssistantTurn(output: Pick<TalkerOutput, "thought" | "bubbles">): string {
  return [`<think>${output.thought ?? ""}</think>`, ...output.bubbles].join("\n");
}

export interface TalkerRequest {
  layer: LayerConfig;
  provider: Provider;
  language: Language;
  character: CharacterState;
  /** 대화 기록 */
  messages: ChatMessage[];
  /** 대화 끝에 붙이는 "[지금]" 블록 */
  context: string;
  /** 비서 말투로 다시 쓰게 할 때의 지적 */
  nudge?: string;
  signal?: AbortSignal;
}

export async function runTalker(request: TalkerRequest): Promise<{ output: TalkerOutput; raw: string }> {
  const messages: ChatMessage[] = [...request.messages, { role: "developer", content: request.context }];
  if (request.nudge) messages.push({ role: "developer", content: request.nudge });
  const { text } = await request.provider.generate({
    purpose: "talker",
    model: request.layer.model,
    instructions: buildInstructions(request.language, request.character),
    messages,
    ...(request.layer.effort ? { effort: request.layer.effort } : {}),
    maxOutputTokens: 8000,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  return { output: parseTalker(text), raw: text };
}
