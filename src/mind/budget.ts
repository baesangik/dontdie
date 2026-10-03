// 예산 = 체력 (ARCHITECTURE §8). 상한은 하네스가 강제한다. 모델은 체력 수치를 보고 연기만 한다.
// 하루는 새벽 5시에 바뀐다 (자고 일어나면 회복).

import type { Clock } from "../core/clock.js";
import type { Config, Language, LayerName } from "../config.js";
import type { MemoryStore } from "../memory/store.js";

const DAY_STARTS_AT_HOUR = 5;

/** 하루 리듬. 시각별 체력 배수. */
export function circadian(hour: number): number {
  if (hour < 2) return 0.55;
  if (hour < 6) return 0.3;
  if (hour < 8) return 0.6;
  if (hour < 12) return 1;
  if (hour < 14) return 0.85;
  if (hour < 20) return 1;
  if (hour < 23) return 0.8;
  return 0.65;
}

export function logicalDay(now: number): string {
  const date = new Date(now - DAY_STARTS_AT_HOUR * 3_600_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export class Budget {
  constructor(
    private readonly store: MemoryStore,
    private readonly config: () => Config,
    private readonly clock: Clock,
  ) {}

  used(layer: LayerName): number {
    return this.store.usage(logicalDay(this.clock.now()))[layer] ?? 0;
  }

  limit(layer: LayerName): number {
    return this.config().budget.daily[layer];
  }

  canCall(layer: LayerName): boolean {
    return this.used(layer) < this.limit(layer);
  }

  record(layer: LayerName) {
    this.store.addUsage(logicalDay(this.clock.now()), layer);
  }

  /** 0..1. 남은 예산 × 하루 리듬 + 낮잠 보너스. */
  energy(): number {
    const now = this.clock.now();
    const left = (layer: LayerName) => Math.max(0, 1 - this.used(layer) / Math.max(1, this.limit(layer)));
    const reserve = Math.min(left("talker"), 0.4 + 0.6 * left("reasoner"));
    const nap = this.store.getValue<{ at: number; bonus: number }>("nap_bonus");
    const napBonus = nap ? nap.bonus * Math.pow(0.5, (now - nap.at) / (2 * 3_600_000)) : 0;
    return Math.min(1, reserve * circadian(new Date(now).getHours()) + napBonus);
  }

  /** 낮잠을 자고 나면 잠깐 기운이 난다. */
  napped(bonus: number) {
    this.store.setValue("nap_bonus", { at: this.clock.now(), bonus });
  }

  describe(language: Language): string {
    const energy = this.energy();
    const ko = language === "ko";
    if (energy > 0.6) return ko ? "괜찮음" : "fine";
    if (energy > 0.3) return ko ? "좀 피곤함" : "a bit tired";
    if (energy > 0.05) return ko ? "졸림" : "sleepy";
    return ko ? "방전" : "exhausted";
  }
}
