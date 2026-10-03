import type { ActionModule, ActionSession } from "./types.js";

const idle: ActionSession = { async tick() { return {}; } };

/** 호출 0회짜리 기본 행동. 아무것도 안 하는데 살아 보이는 가장 싼 방법. */
const zoneOut: ActionModule = {
  kind: "zone_out",
  label: { ko: "멍때리는 중", en: "spacing out" },
  summary: { ko: "멍때림", en: "spaced out" },
  sprite: "blank",
  minutes: [5, 20],
  ticks: [0, 0],
  interruptibility: 1,
  energyCost: 0,
  start: () => idle,
};

const nap: ActionModule = {
  kind: "nap",
  label: { ko: "꾸벅꾸벅 조는 중", en: "dozing off" },
  summary: { ko: "낮잠 잠", en: "took a nap" },
  sprite: "sleep",
  minutes: [15, 45],
  ticks: [0, 0],
  interruptibility: 0.4,
  energyCost: -0.25,
  weight: 0.2,
  start: () => idle,
};

/** 모르는 것 사다리의 마지막 칸: 아까 물어보다 만 것, 나중에 찾아보자던 것을 혼자 찾아본다. */
const lookUpQuestion: ActionModule = {
  kind: "look_up_question",
  label: { ko: "궁금했던 거 찾아보는 중", en: "looking something up" },
  summary: { ko: "궁금했던 거 찾아봄", en: "looked something up" },
  sprite: "search",
  minutes: [3, 8],
  ticks: [1, 1],
  interruptibility: 0.8,
  energyCost: 0.05,
  weight: 3,
  available: (context) => context.questions().length > 0,
  start(context) {
    const question = context.questions()[0];
    return {
      async tick(tickContext) {
        if (!question) return { done: true };
        const note = await tickContext.lookup(question.term, null);
        if (!note) return { done: true };
        const ko = tickContext.language === "ko";
        const observation = note.found
          ? (ko ? `궁금했던 '${question.term}' 찾아봄: ${note.answer}` : `Looked up '${question.term}': ${note.answer}`)
          : (ko ? `'${question.term}' 찾아봤는데 잘 모르겠음` : `Looked up '${question.term}' but couldn't find much`);
        return { observation, topic: question.term, done: true };
      },
    };
  },
};

export const BUILTIN_ACTIONS: readonly ActionModule[] = [zoneOut, nap, lookUpQuestion];

export class ActionRegistry {
  #modules = new Map<string, ActionModule>();

  constructor(modules: readonly ActionModule[] = BUILTIN_ACTIONS) {
    for (const module of modules) this.register(module);
  }

  register(module: ActionModule) {
    if (this.#modules.has(module.kind)) throw new Error(`action already registered: ${module.kind}`);
    this.#modules.set(module.kind, module);
  }

  get(kind: string) { return this.#modules.get(kind); }
  list() { return [...this.#modules.values()]; }
}
