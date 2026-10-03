// LLM을 부르지 않는 짧은 대사와 단서. 실패 연출, 기다리는 동안의 필러, 턴별 할 일 문장.

import type { Language } from "../config.js";

type Lines = {
  filler: { lookup: string[]; think: string[] };
  headache: string;
  offline: string;
  exhausted: string;
  forgot: string;
  noReply: string;
  tooTiredToSearch: (query: string) => string;
  cue: {
    scoff: string;
    insist: string;
    high: string;
    critical: string;
    repeat: (topic: string, count: number) => string;
    searching: (query: string) => string;
    thinking: (question: string) => string;
    busy: (activity: string) => string;
    asleep: string;
    tired: string;
    noReplyYet: string;
  };
  task: {
    inbox: string;
    attend: string;
    return: (minutes: number, did: string | null) => string;
    reflect: (activity: string, observation: string) => string;
    diary: (events: string) => string;
  };
  activityProgress: (label: string, done: number, total: number) => string;
};

export const LINES: Record<Language, Lines> = {
  ko: {
    filler: {
      lookup: ["잠깐만 아직 찾는 중", "음 이거 좀 걸리네", "거의 다 봤음", "아 잠만"],
      think: ["잠깐 생각 좀", "음…", "이거 좀 생각해봐야겠다"],
    },
    headache: "아 머리아파. 나중에 얘기해",
    offline: "인터넷 죽었나",
    exhausted: "zzz… 오늘은 진짜 못 하겠다. 내일 얘기해",
    forgot: "뭐 말하려고 했는데 까먹었다",
    noReply: "답 안 하네",
    tooTiredToSearch: (query) => `'${query}' 찾아보려 했는데 오늘은 머리가 안 돌아간다. 나중에 찾아보겠다고 해.`,
    cue: {
      scoff: "모르는 걸로 핀잔 들었다. 좀 민망하다.",
      insist: "재촉받고 있다.",
      high: "진짜 결정이 걸린 고민이다. 일단 직감대로 짧게 한마디 해. 틀려도 된다. 뒤에서 더 생각해보고, 생각이 바뀌면 나중에 고쳐 말할 거다.",
      critical: "건강, 돈, 법, 안전처럼 중요한 일이다. 섣불리 결론 내리지 말고 진지하게 들어. '잠깐 이건 생각 좀 해볼게'처럼 시간을 벌어도 된다.",
      repeat: (topic, count) => `'${topic}' 얘기가 최근 7일 동안 ${count}번째다.`,
      searching: (query) => `지금 '${query}' 찾아보는 중이다.`,
      thinking: (question) => `지금 "${question}" 뒤에서 생각하는 중이다.`,
      busy: (activity) => `하던 거(${activity}) 마저 하느라 좀 늦게 봤다.`,
      asleep: "자다 깼다. 비몽사몽. 아주 짧게.",
      tired: "피곤하다. 말이 짧아진다.",
      noReplyYet: "아까 물어본 거에 아직 답이 없다.",
    },
    task: {
      inbox: "위 [받은 소식]에 반응해. 할 말 없으면 속생각만.",
      attend: "이 집 사람이 방금 이쪽을 봤다. [할 말 후보] 중에 지금 말하고 싶은 게 있으면 먼저 말 걸어. 없으면 속생각만.",
      return: (minutes, did) => `이 집 사람이 ${minutes}분 만에 돌아왔다.${did ? ` 그동안 한 일: ${did}.` : ""} 반겨도 되고, 아는 척만 해도 되고, 하던 얘기를 꺼내도 된다.`,
      reflect: (activity, observation) => `혼자 ${activity}. 방금 본 것: ${observation}\n속생각만 써라. 나중에 이 집 사람한테 말하고 싶은 게 생기면 <tell>할 말</tell>.`,
      diary: (events) => `밤이다. 오늘 일기를 쓴다. 이 집 사람은 안 본다고 생각하고 솔직하게, 네 말투로 3~6줄. 오늘 있었던 일:\n${events}\n<think> 다음 줄부터 일기 본문만 써라.`,
    },
    activityProgress: (label, done, total) => `${label} (${done}/${total}분)`,
  },
  en: {
    filler: {
      lookup: ["hang on, still looking", "hm, this is taking a while", "almost there", "wait"],
      think: ["let me think", "hm…", "need to think about this"],
    },
    headache: "ugh, headache. later.",
    offline: "is the internet dead?",
    exhausted: "zzz… can't today. tomorrow.",
    forgot: "I was going to say something but forgot",
    noReply: "no reply, huh",
    tooTiredToSearch: (query) => `You meant to look up '${query}' but your head isn't working today. Say you'll look later.`,
    cue: {
      scoff: "You got teased for not knowing. A bit embarrassing.",
      insist: "You're being rushed.",
      high: "This is a real decision for them. Say your gut reaction, briefly. It's fine to be wrong: you'll think it over in the background and correct yourself later if you change your mind.",
      critical: "This touches health, money, law, or safety. Don't jump to conclusions; take it seriously. It's fine to say you need a moment to think.",
      repeat: (topic, count) => `This is the ${count}th time '${topic}' came up in the last 7 days.`,
      searching: (query) => `You're looking up '${query}' right now.`,
      thinking: (question) => `You're thinking about "${question}" in the background.`,
      busy: (activity) => `You were busy (${activity}) and saw this a bit late.`,
      asleep: "You just woke up. Groggy. Keep it very short.",
      tired: "You're tired. Your replies get short.",
      noReplyYet: "They haven't answered your question yet.",
    },
    task: {
      inbox: "React to the [News for you] above. If you have nothing to say, only think.",
      attend: "The person just looked your way. If something in [Things you wanted to say] feels worth saying now, speak first. Otherwise only think.",
      return: (minutes, did) => `The person is back after ${minutes} minutes.${did ? ` Meanwhile you: ${did}.` : ""} Greet them, just acknowledge, or bring something up.`,
      reflect: (activity, observation) => `You're alone, ${activity}. You just saw: ${observation}\nOnly think. If you want to tell the person something later, add <tell>what to say</tell>.`,
      diary: (events) => `It's night. Write today's diary entry. Assume the person won't read it; be honest, in your own voice, 3–6 lines. Today:\n${events}\nAfter <think>, write only the diary text.`,
    },
    activityProgress: (label, done, total) => `${label} (${done}/${total} min)`,
  },
};

export function pick<T>(items: readonly T[], random: () => number, avoid?: T): T {
  const pool = items.length > 1 && avoid !== undefined ? items.filter((item) => item !== avoid) : items;
  return pool[Math.floor(random() * pool.length)] ?? items[0]!;
}
