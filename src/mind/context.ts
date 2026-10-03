// Talker에게 매 턴 넣는 "[지금]" 블록. 상태, 떠오른 기억, 받은 소식, 무의식(Router에서 나온 단서)을 담는다.
// 존재 규칙(instructions)은 고정해서 프롬프트 캐시를 타고, 바뀌는 건 전부 대화 끝의 이 블록에 넣는다.

import type { Language } from "../config.js";
import type { Memory } from "../memory/store.js";
import type { LadderStep } from "./ladder.js";
import type { ReasonerNote } from "./reasoner.js";

export type TurnKind = "reply" | "inbox" | "attend" | "return" | "reflect";

export interface TurnContext {
  kind: TurnKind;
  now: string;
  mood: string | null;
  energy: string;
  activity: string | null;
  /** 자다 깼다 */
  asleep: boolean;
  addressAs: string | null;
  /** 이 집 사람에 대해 아는 것 (취향) */
  prefs: string[];
  memories: string[];
  inbox: string[];
  cues: string[];
  queue: string[];
  /** 이번 턴에 할 일 (먼저 말 걸기, 혼자 생각하기 …) */
  task?: string | undefined;
}

const HEAD: Record<Language, Record<string, string>> = {
  ko: { now: "[지금]", state: "[상태]", person: "[이 집 사람]", memories: "[떠오른 기억]", inbox: "[받은 소식]", cues: "[무의식]", queue: "[할 말 후보]", task: "[지금 할 일]", mood: "기분", energy: "체력", activity: "하던 것", asleep: "자다 깸", address: "부르는 말", prefs: "아는 것" },
  en: { now: "[Now]", state: "[State]", person: "[The person here]", memories: "[Memories that come to mind]", inbox: "[News for you]", cues: "[Gut feeling]", queue: "[Things you wanted to say]", task: "[Right now]", mood: "mood", energy: "energy", activity: "doing", asleep: "just woke up", address: "you call them", prefs: "you know" },
};

export function renderContext(context: TurnContext, language: Language): string {
  const h = HEAD[language];
  const out: string[] = [`${h.now} ${context.now}`];
  const state = [
    context.mood ? `${h.mood}: ${context.mood}` : null,
    `${h.energy}: ${context.energy}`,
    context.activity ? `${h.activity}: ${context.activity}` : null,
    context.asleep ? h.asleep : null,
  ].filter(Boolean);
  out.push(`${h.state} ${state.join(" · ")}`);
  const person = [
    context.addressAs ? `${h.address}: ${context.addressAs}` : null,
    context.prefs.length ? `${h.prefs}: ${context.prefs.join(" / ")}` : null,
  ].filter(Boolean);
  if (person.length) out.push(`${h.person} ${person.join(" · ")}`);
  const section = (title: string, items: string[]) => {
    if (items.length) out.push(title, ...items.map((item) => `- ${item}`));
  };
  section(h.memories!, context.memories);
  section(h.inbox!, context.inbox);
  section(h.cues!, context.cues);
  section(h.queue!, context.queue);
  if (context.task) out.push(`${h.task} ${context.task}`);
  return out.join("\n");
}

// ── 줄 만들기 ──

export function ago(ms: number, language: Language): string {
  const minutes = Math.round(ms / 60_000);
  const ko = language === "ko";
  if (minutes < 2) return ko ? "방금" : "just now";
  if (minutes < 60) return ko ? `${minutes}분 전` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ko ? `${hours}시간 전` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return ko ? `${days}일 전` : `${days}d ago`;
}

const SOURCE: Record<Language, Record<string, string>> = {
  ko: { user: "이 집 사람이 알려줌", search: "찾아봄", own: "혼자 알아냄", activity: "보다가 알게 됨", self: "", episode: "" },
  en: { user: "the person told you", search: "you looked it up", own: "you figured it out", activity: "you came across it", self: "", episode: "" },
};

export function memoryLine(memory: Memory, now: number, language: Language): string {
  const source = memory.kind === "episode" ? "" : SOURCE[language][memory.source] ?? "";
  const when = ago(now - memory.createdAt, language);
  const tail = [source, when].filter(Boolean).join(", ");
  return `${memory.key ? `${memory.key}: ` : ""}${memory.content} (${tail})`;
}

const HINT_NAMES: Record<string, Record<Language, string>> = {
  dcinside: { ko: "디시", en: "DCInside" },
  namuwiki: { ko: "나무위키", en: "Namuwiki" },
  wikipedia: { ko: "위키백과", en: "Wikipedia" },
  google: { ko: "구글", en: "Google" },
  naver: { ko: "네이버", en: "Naver" },
  youtube: { ko: "유튜브", en: "YouTube" },
  reddit: { ko: "레딧", en: "Reddit" },
};

export function hintName(hint: string | null, language: Language): string | null {
  if (!hint) return null;
  return HINT_NAMES[hint]?.[language] ?? hint;
}

/** 모르는 것 사다리 단계 → 무의식 단서 한 줄. 기억에서 찾은 건 [떠오른 기억]으로 가므로 여기선 안 쓴다. */
export function ladderCue(step: LadderStep, language: Language): string | null {
  const ko = language === "ko";
  const t = step.term;
  switch (step.stage) {
    case "known":
    case "remembered":
    case "ignore":
      return null;
    case "guess":
      return ko ? `'${t}' — 아마 ${step.guess}? 확실하진 않다. 확인하듯 한번 찔러봐.` : `'${t}' — maybe ${step.guess}? Not sure. Check it casually.`;
    case "ask":
      if (step.kind === "person") return ko ? `'${t}'가 누군지 모른다. 아는 척하지 말고 누군지 물어봐.` : `You don't know who '${t}' is. Don't pretend; ask.`;
      if (step.kind === "place") return ko ? `'${t}'가 어딘지 모른다. 물어봐.` : `You don't know where '${t}' is. Ask.`;
      if (step.kind === "event") return ko ? `'${t}' — 처음 듣는 소식이다. 설명하거나 훈계하지 말고, 놀라거나 물어봐.` : `'${t}' is news to you. Don't explain or lecture; react or ask.`;
      return ko ? `'${t}'가 뭔지 정확히 모른다. 아는 척하지 말고 짧게 물어봐. 바로 검색하지는 마.` : `You don't really know what '${t}' means. Don't pretend; ask briefly. Don't look it up yet.`;
    case "search": {
      const where = hintName(step.hint ?? null, language);
      return ko
        ? `${where ? `${where}에서 ` : ""}'${step.query ?? t}' 찾아보라고 한다. 찾아볼 거면 말 끝에 <consult>${step.query ?? t}</consult>를 붙여. 결과는 나중에 온다. 귀찮으면 안 찾아도 된다.`
        : `They want you to look up '${step.query ?? t}'${where ? ` on ${where}` : ""}. If you will, end with <consult>${step.query ?? t}</consult>. Results come later. You may refuse if you can't be bothered.`;
    }
    case "unsearchable":
      return ko ? `'${t}'는 이 집 사람 주변 얘기라 검색해도 안 나온다. 그렇다고 말하고 누군지/뭔지 물어봐.` : `'${t}' is from their own life; searching won't help. Say so and ask.`;
    case "later":
      return ko ? `'${t}'가 뭔지 모르지만 지금 물어볼 상황은 아니다. 나중에 혼자 찾아볼 거면 <later>${t}</later>.` : `You don't know '${t}', but now isn't the time to ask. To look it up later on your own: <later>${t}</later>.`;
  }
}

export function noteLine(note: ReasonerNote, language: Language): string {
  const ko = language === "ko";
  if (note.kind === "lookup") {
    const where = hintName(note.hint, language);
    if (!note.found) return ko ? `'${note.query}' 찾아봤는데 잘 안 나온다. 못 찾았다고 해.` : `You looked up '${note.query}' but found nothing solid. Say you couldn't find it.`;
    const sure = note.confidence >= 0.75 ? (ko ? "확실" : "sure") : note.confidence >= 0.45 ? (ko ? "아마도" : "probably") : (ko ? "긴가민가" : "unsure");
    const site = note.sources[0] ? new URL(note.sources[0].url).hostname.replace(/^www\./, "") : null;
    return ko
      ? `'${note.query}' 찾아봄${where ? ` (${where} 보라고 했음)` : ""}: ${note.answer} [${sure}${site ? `, ${site}` : ""}]`
      : `You looked up '${note.query}'${where ? ` (they said try ${where})` : ""}: ${note.answer} [${sure}${site ? `, ${site}` : ""}]`;
  }
  const reasons = note.reasons.length ? (ko ? ` 이유: ${note.reasons.join("; ")}.` : ` Why: ${note.reasons.join("; ")}.`) : "";
  const caution = note.caution ? (ko ? ` 주의: ${note.caution}` : ` Careful: ${note.caution}`) : "";
  if (note.reflex) {
    return ko
      ? `아까 "${note.question}"에 "${note.reflex}"라고 했다. 다시 생각해보니: ${note.conclusion}.${reasons}${caution} ${note.agrees === false ? "생각이 바뀌었다. '……아 근데' 하고 고쳐 말해." : "결론은 비슷하다. 굳이 다시 말 안 해도 된다."}`
      : `Earlier you answered "${note.question}" with "${note.reflex}". On reflection: ${note.conclusion}.${reasons}${caution} ${note.agrees === false ? "You changed your mind. Correct yourself ('...actually, wait')." : "Same conclusion. No need to say it again."}`;
  }
  return ko ? `"${note.question}" 생각해봤다: ${note.conclusion}.${reasons}${caution}` : `You thought about "${note.question}": ${note.conclusion}.${reasons}${caution}`;
}
