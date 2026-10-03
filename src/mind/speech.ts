// 할 말 큐 (MECHANISMS §7). 속생각 중 나중에 말하고 싶은 것을 쌓아둔다.
// 동기는 시간이 지나면 감쇠한다: m(t) = m0 · e^(−t/τ). 말할 틈을 못 찾으면 잊힌다.

import type { MemoryStore } from "../memory/store.js";

const KEY = "speech_queue";
const DROP_BELOW = 0.08;
/** 동기가 높았던 말을 잊었을 때 "뭐 말하려 했는데 까먹었다"가 될 확률 */
const FORGOT_CHANCE = 0.3;

export interface Utterance {
  id: string;
  /** Talker에게 줄 내용 ("아까 회사 얘기, 다시 생각해보니 …") */
  text: string;
  /** 주제 (같은 주제는 하나만 남긴다) */
  about: string | null;
  m0: number;
  createdAt: number;
  /** 감쇠 시간 상수 (ms) */
  tau: number;
  /** revise | search | activity | forgot | name … */
  source: string;
}

export function motivation(item: Utterance, now: number): number {
  return item.m0 * Math.exp(-Math.max(0, now - item.createdAt) / item.tau);
}

export class SpeechQueue {
  #items: Utterance[];
  #seq = 0;

  constructor(private readonly store: MemoryStore | null, private readonly random: () => number = Math.random) {
    this.#items = store?.getValue<Utterance[]>(KEY) ?? [];
  }

  get items(): readonly Utterance[] { return this.#items; }

  add(input: Omit<Utterance, "id" | "createdAt"> & { createdAt?: number }, now: number): Utterance {
    const item: Utterance = { ...input, id: `u${now.toString(36)}${(this.#seq++).toString(36)}`, createdAt: input.createdAt ?? now };
    if (item.about) {
      const same = this.#items.find((entry) => entry.about === item.about);
      if (same && motivation(same, now) >= item.m0) return same;
      this.#items = this.#items.filter((entry) => entry.about !== item.about);
    }
    this.#items.push(item);
    this.#save();
    return item;
  }

  /** 동기가 min 이상인 것, 높은 순. */
  top(now: number, min = 0): (Utterance & { m: number })[] {
    return this.#items
      .map((item) => ({ ...item, m: motivation(item, now) }))
      .filter((item) => item.m >= min)
      .sort((a, b) => b.m - a.m);
  }

  take(id: string): Utterance | undefined {
    const item = this.#items.find((entry) => entry.id === id);
    if (item) {
      this.#items = this.#items.filter((entry) => entry !== item);
      this.#save();
    }
    return item;
  }

  /** 감쇠한 것을 버린다. 동기가 높았던 걸 잊으면 가끔 "까먹었다"가 남는다. */
  decay(now: number, forgotText: string): { dropped: Utterance[]; forgot?: Utterance } {
    const dropped = this.#items.filter((item) => motivation(item, now) < DROP_BELOW);
    if (!dropped.length) return { dropped };
    this.#items = this.#items.filter((item) => !dropped.includes(item));
    let forgot: Utterance | undefined;
    if (dropped.some((item) => item.m0 >= 0.7 && item.source !== "forgot") && this.random() < FORGOT_CHANCE) {
      forgot = { id: `f${now.toString(36)}`, text: forgotText, about: "forgot", m0: 0.45, createdAt: now, tau: 2 * 3_600_000, source: "forgot" };
      this.#items.push(forgot);
    }
    this.#save();
    return forgot ? { dropped, forgot } : { dropped };
  }

  #save() {
    this.store?.setValue(KEY, this.#items);
  }
}
