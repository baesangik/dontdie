// 비서 말투 감지와 메신저 말투로 다듬기 (MECHANISMS §14).
// 날것 GPT는 비서처럼 말하려는 경향이 있다. 하네스가 출력을 검사해서, 심하면 다시 쓰게 하고, 가벼우면 다듬는다.

import type { Language } from "../config.js";

export const REGENERATE_AT = 2;
const LONG_BUBBLE = 80;
const LONG_TOTAL = 140;
const SPLIT_OVER = 30;
const MAX_BUBBLES = 4;

type Pattern = [pattern: RegExp, weight: number, label: string];

const PATTERNS: Record<Language, Pattern[]> = {
  ko: [
    [/도와\s*(드릴|줄)\s*(까|게|수)/, 2, "도와줄까"],
    [/궁금한\s*(점|게|거|것)\s*(이|가)?\s*(있|생기)/, 2, "궁금한 점 있으면"],
    [/언제든(지)?/, 1, "언제든"],
    [/(어떤|어느)\s*(쪽|면|부분|점)(이|을|에)?\s*(궁금|알고\s*싶|얘기|말하)/, 2, "어떤 쪽이 궁금해"],
    [/(뭐가|무엇이|무엇을)\s*궁금/, 1.5, "뭐가 궁금해"],
    [/말씀/, 1.5, "말씀"],
    [/좋은\s*질문/, 2, "좋은 질문"],
    [/(요약|정리)하(자면|면)/, 1.5, "요약하자면"],
    [/(첫째|둘째|셋째)/, 2, "첫째 둘째"],
    [/참고로/, 1, "참고로"],
    [/(개인적인|내|제)\s*(감상|의견|생각|취향)(은|이)\s*(없|딱히)/, 2, "감상은 없어"],
    [/(직접|실제로)\s*(겪어|경험해|본\s*적|만나\s*본\s*적).{0,12}(없|아니라|못\s*해)/, 1.5, "직접 겪어본 적 없어서"],
    [/(AI|인공지능|언어\s*모델|챗봇)(이|라|으로서|로서|이라서)/, 3, "AI라서"],
    [/(습니다|십시오|드립니다)/, 1, "합니다체"],
    [/(것이|게)\s*(중요|바람직|좋을\s*것)/, 1, "~것이 중요"],
    [/어느\s*쪽이든/, 1, "어느 쪽이든"],
  ],
  en: [
    [/\b(happy|glad) to help\b/i, 2, "happy to help"],
    [/\blet me know if\b/i, 2, "let me know if"],
    [/\bfeel free\b/i, 1.5, "feel free"],
    [/\bas an ai\b|\blanguage model\b/i, 3, "as an AI"],
    [/\bgreat question\b/i, 2, "great question"],
    [/\bin summary\b|\bto summarize\b/i, 1.5, "in summary"],
    [/\bit'?s important to\b/i, 1, "it's important to"],
    [/\bi don'?t have personal (opinions|experiences|feelings)\b/i, 2, "no personal opinions"],
    [/\bwhich (aspect|part)\b/i, 2, "which aspect"],
    [/\bwould you like\b/i, 1, "would you like"],
    [/\b(firstly|secondly)\b/i, 2, "firstly"],
  ],
};

export interface AssistantismReport {
  score: number;
  hits: string[];
}

export function detectAssistantism(bubbles: readonly string[], language: Language): AssistantismReport {
  const text = bubbles.join("\n");
  const hits: string[] = [];
  let score = 0;
  for (const [pattern, weight, label] of PATTERNS[language]) {
    if (pattern.test(text)) {
      score += weight;
      hits.push(label);
    }
  }
  const long = bubbles.filter((bubble) => [...bubble].length > LONG_BUBBLE).length;
  if (long) {
    score += Math.min(2, long);
    hits.push(language === "ko" ? "긴 말풍선" : "long bubble");
  }
  if ([...text].length > LONG_TOTAL) {
    score += 1;
    hits.push(language === "ko" ? "길게 말함" : "too long");
  }
  return { score, hits };
}

/** 서비스 멘트만 있는 문장 ("궁금한 점 있으면 말해줘")은 다른 말이 있으면 뺀다. */
function isServiceLine(sentence: string, language: Language): boolean {
  return PATTERNS[language].slice(0, 3).some(([pattern]) => pattern.test(sentence));
}

/** 긴 말풍선을 문장 단위로 나누고, 끝 마침표를 떼고, 최대 4개로 자른다. */
export function humanize(bubbles: readonly string[], language: Language): string[] {
  const sentences = bubbles.flatMap((bubble) =>
    [...bubble].length > SPLIT_OVER ? bubble.split(/(?<=[.!?…])\s+(?=\S)/u) : [bubble]);
  const kept = sentences.length > 1 ? sentences.filter((sentence) => !isServiceLine(sentence, language)) : sentences;
  return (kept.length ? kept : sentences)
    .map((sentence) => sentence.trim().replace(/(?<![.…])\.$/u, ""))
    .filter(Boolean)
    .slice(0, MAX_BUBBLES);
}
