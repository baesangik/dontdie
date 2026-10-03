// Talker (자아). 존재 규칙 + 현재 상태 + 대화로 컨텍스트를 만들고, 출력에서 말풍선과 속생각을 꺼낸다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type Language, type LayerConfig } from "../config.js";
import { dayCount, type CharacterState } from "../character/state.js";
import type { ChatMessage, Provider } from "../providers/types.js";

export const MAX_BUBBLES = 4;

export interface TalkerOutput {
  thought?: string;
  bubbles: string[];
  acceptName?: string;
  refuseName?: string;
  acceptAddress?: string;
  refuseAddress?: string;
}

/** [key] / [!key] 줄 머리표와 {{key}} 치환을 처리한다. HTML 주석은 지운다. */
export function renderTemplate(template: string, values: Record<string, string | undefined>): string {
  return template
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .flatMap((line) => {
      const marker = /^\[(!?)([a-z_]+)\]\s?/.exec(line);
      if (!marker) return [line];
      const present = Boolean(values[marker[2]!]);
      if (marker[1] === "!" ? present : !present) return [];
      return [line.slice(marker[0].length)];
    })
    .join("\n")
    .replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => values[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prompt(name: string, language: Language): string {
  return readFileSync(join(ROOT, "prompts", `${name}.${language}.md`), "utf8");
}

const PART_OF_DAY: Record<Language, [number, string][]> = {
  ko: [[5, "새벽"], [9, "아침"], [12, "오전"], [14, "점심"], [18, "오후"], [21, "저녁"], [24, "밤"]],
  en: [[5, "late night"], [9, "morning"], [12, "late morning"], [14, "midday"], [18, "afternoon"], [21, "evening"], [24, "night"]],
};

export function describeNow(now: number, language: Language, character: CharacterState): string {
  const date = new Date(now);
  const hour = date.getHours();
  const part = PART_OF_DAY[language].find(([until]) => hour < until)?.[1] ?? "";
  const stamp = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { dateStyle: "full", timeStyle: "short" }).format(date);
  const day = dayCount(character, now);
  return language === "ko" ? `${stamp} (${part}). 이 집에 온 지 ${day}일째.` : `${stamp} (${part}). Day ${day} in this house.`;
}

export function buildInstructions(language: Language, character: CharacterState, now: number): string {
  const values = { name: character.name?.value, address_as: character.addressAs?.value, now: describeNow(now, language, character) };
  return `${renderTemplate(prompt("charter", language), values)}\n\n${renderTemplate(prompt("format", language), values)}`;
}

const TAG = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i");

export function parseTalker(raw: string): TalkerOutput {
  let text = raw.replace(/\r/g, "");
  const output: TalkerOutput = { bubbles: [] };

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
  const acceptName = take("name");
  const refuseName = take("refuse_name");
  const acceptAddress = take("address");
  const refuseAddress = take("refuse_address");
  if (acceptName) output.acceptName = acceptName;
  if (refuseName) output.refuseName = refuseName;
  if (acceptAddress) output.acceptAddress = acceptAddress;
  if (refuseAddress) output.refuseAddress = refuseAddress;

  output.bubbles = text
    .replace(/<\/?[a-z_]+>/gi, "")
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
  now: number;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export async function runTalker(request: TalkerRequest): Promise<{ output: TalkerOutput; raw: string }> {
  const { text } = await request.provider.generate({
    model: request.layer.model,
    instructions: buildInstructions(request.language, request.character, request.now),
    messages: request.messages,
    ...(request.layer.effort ? { effort: request.layer.effort } : {}),
    maxOutputTokens: 8000,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  return { output: parseTalker(text), raw: text };
}
