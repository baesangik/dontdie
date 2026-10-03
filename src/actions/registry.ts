import type { ActionModule, ActionSession } from "./types.js";

const idle: ActionSession = { async tick() { return {}; } };

/** 호출 0회짜리 기본 행동. 아무것도 안 하는데 살아 보이는 가장 싼 방법. */
const zoneOut: ActionModule = {
  kind: "zone_out",
  label: { ko: "멍때리는 중", en: "spacing out" },
  sprite: "zone_out",
  minutes: [5, 20],
  ticks: [0, 0],
  interruptibility: 1,
  energyCost: 0,
  start: () => idle,
};

const nap: ActionModule = {
  kind: "nap",
  label: { ko: "꾸벅꾸벅 조는 중", en: "dozing off" },
  sprite: "nap",
  minutes: [15, 45],
  ticks: [0, 0],
  interruptibility: 0.4,
  energyCost: -0.2,
  start: () => idle,
};

export class ActionRegistry {
  #modules = new Map<string, ActionModule>();

  constructor(modules: ActionModule[] = [zoneOut, nap]) {
    for (const module of modules) this.register(module);
  }

  register(module: ActionModule) {
    if (this.#modules.has(module.kind)) throw new Error(`action already registered: ${module.kind}`);
    this.#modules.set(module.kind, module);
  }

  get(kind: string) { return this.#modules.get(kind); }
  list() { return [...this.#modules.values()]; }
}
