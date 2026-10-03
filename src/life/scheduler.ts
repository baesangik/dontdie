// 생활 스케줄러 (MECHANISMS §4, §5, §12). 혼자 있을 때 활동 블록을 잡고, 계획 시간 동안 틱을 드문드문만 부른다.
// 30분짜리 활동도 실제 호출은 몇 번뿐이다. 틱 사이에는 UI가 스프라이트와 라벨만 보여준다.
// 밤에는 자고, 자기 전에 기억을 정리한다.

import type { ActionContext, ActionModule, ActionSession } from "../actions/types.js";
import type { ActionRegistry } from "../actions/registry.js";
import type { AttentionState } from "../core/attention.js";
import type { Cancel, Clock } from "../core/clock.js";
import type { EventLog } from "../core/eventlog.js";
import { inQuietHours, type Config } from "../config.js";

const CHECK_MS = 30_000;
const BUSY_STATES: readonly AttentionState[] = ["attending", "engaged", "winding_down"];

export interface RunningActivity {
  kind: string;
  label: string;
  /** 끝난 뒤 한 일 요약 */
  summary: string;
  sprite: string;
  topic?: string;
  startedAt: number;
  endsAt: number;
  /** 틱을 부를 시각들 (아직 안 부른 것만) */
  tickAt: number[];
  ticks: number;
  pausedAt: number | null;
  interruptibility: number;
  energyCost: number;
  session: ActionSession;
}

/** Harness가 생활 스케줄러에 열어주는 것들. */
export interface LifeHost {
  readonly clock: Clock;
  readonly log: EventLog;
  readonly config: Config;
  readonly busy: boolean;
  readonly attentionState: AttentionState;
  lastInteractionAt(): number;
  energy(): number;
  actionContext(signal: AbortSignal, topic?: string): ActionContext;
  /** 활동하다 본 것 → 속생각 */
  reflect(activity: RunningActivity, observation: string): void;
  activityEnded(activity: RunningActivity, reason: string): void;
  sleepStarted(): void;
  wokeUp(): void;
  /** 오늘 일기를 아직 안 썼고 쓸 시간이면 true */
  diaryDue(): boolean;
  writeDiary(): void;
}

export class Life {
  #current: RunningActivity | null = null;
  #asleep = false;
  #timer: Cancel | null = null;
  #checking = false;
  #last: string | null = null;
  #abort = new AbortController();

  constructor(
    private readonly host: LifeHost,
    private readonly registry: ActionRegistry,
    private readonly random: () => number = Math.random,
  ) {}

  get current() { return this.#current; }
  get asleep() { return this.#asleep; }

  start() {
    this.#schedule();
  }

  stop() {
    this.#timer?.();
    this.#timer = null;
    this.#abort.abort();
  }

  /** 지금 하는 일 설명 ("멍때리는 중 (3/12분)") */
  describe(format: (label: string, done: number, total: number) => string): string | null {
    const current = this.#current;
    if (!current) return null;
    const now = this.host.clock.now();
    const pace = this.host.config.pace;
    const total = Math.max(1, Math.round((current.endsAt - current.startedAt) * pace / 60_000));
    const done = Math.min(total, Math.round(((current.pausedAt ?? now) - current.startedAt) * pace / 60_000));
    return format(current.label, done, total);
  }

  /** 한 번 점검한다. 타이머가 부르고, 테스트에서 직접 부를 수도 있다. */
  async check() {
    if (this.#checking) return;
    this.#checking = true;
    try {
      await this.#check();
    } catch (error) {
      this.host.log.append("error", { layer: "life", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.#checking = false;
    }
  }

  async #check() {
    const { host } = this;
    const config = host.config;
    const now = host.clock.now();
    if (!config.life.enabled) {
      if (this.#current) this.#end("disabled");
      if (this.#asleep) this.#wake();
      return;
    }

    const quiet = inQuietHours(config.life.quietHours, now);
    if (quiet && !this.#asleep && !BUSY_STATES.includes(host.attentionState) && !host.busy) {
      if (this.#current) this.#end("sleep");
      this.#asleep = true;
      host.log.append("sleep", { state: "asleep" });
      host.sleepStarted();
      return;
    }
    if (!quiet && this.#asleep) this.#wake();
    if (this.#asleep) return;

    // 대화 중이면 하던 일은 멈춘다 (연출상). 대화가 끝나면 이어서 한다.
    if (host.busy || BUSY_STATES.includes(host.attentionState)) {
      if (this.#current && this.#current.pausedAt === null) {
        this.#current.pausedAt = now;
        host.log.append("activity", { phase: "pause", kind: this.#current.kind });
      }
      return;
    }
    if (this.#current?.pausedAt != null) this.#resume(now);

    if (host.diaryDue()) {
      host.writeDiary();
      return;
    }

    const current = this.#current;
    if (current) {
      const due = current.tickAt[0];
      if (due !== undefined && due <= now) {
        current.tickAt.shift();
        const index = current.ticks - current.tickAt.length - 1;
        const result = await current.session.tick(host.actionContext(this.#abort.signal, current.topic), index);
        if (this.#current !== current) return;
        host.log.append("activity", { phase: "tick", kind: current.kind, index, observation: result.observation ?? null });
        if (result.observation) host.reflect(current, result.observation);
        if (result.done) {
          this.#end("done");
          if (result.followUp) await this.#start(result.followUp.kind, result.followUp.topic);
          return;
        }
      }
      if (host.clock.now() >= current.endsAt) this.#end("done");
      return;
    }

    const idleMs = config.life.idleBeforeActivityMin * 60_000 / config.pace;
    if (now - host.lastInteractionAt() >= idleMs) {
      const module = await this.#choose();
      if (module) await this.#start(module.kind);
    }
  }

  /** 자유시간 선택 (MECHANISMS §5): 가중치 = 기본 × 체력 × 지루함. */
  async #choose(): Promise<ActionModule | undefined> {
    const context = this.host.actionContext(this.#abort.signal);
    const energy = this.host.energy();
    const candidates: { module: ActionModule; weight: number }[] = [];
    for (const module of this.registry.list()) {
      if (module.available && !(await module.available(context))) continue;
      let weight = module.weight ?? 1;
      if (module.energyCost < 0) weight *= energy < 0.35 ? 15 : 1;
      else if (module.energyCost > 0) weight *= energy < 0.2 ? 0.1 : 1;
      if (module.kind === this.#last) weight *= 0.3;
      if (weight > 0) candidates.push({ module, weight });
    }
    const total = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.random() * total;
    for (const entry of candidates) {
      roll -= entry.weight;
      if (roll <= 0) return entry.module;
    }
    return candidates.at(-1)?.module;
  }

  async #start(kind: string, topic?: string) {
    const module = this.registry.get(kind);
    if (!module) return;
    const { host } = this;
    const now = host.clock.now();
    const pace = host.config.pace;
    const minutes = between(module.minutes, this.random);
    const duration = minutes * 60_000 / pace;
    const ticks = Math.round(between(module.ticks, this.random));
    // 틱은 고르게 흩되 지터를 넣는다. 너무 규칙적이면 기계 같다.
    const tickAt = Array.from({ length: ticks }, (_, i) => now + duration * (i + 0.5 + (this.random() - 0.5) * 0.3) / ticks).sort((a, b) => a - b);
    const session = await module.start(host.actionContext(this.#abort.signal, topic));
    this.#current = {
      kind, label: module.label[host.config.language], summary: module.summary[host.config.language], sprite: module.sprite, ...(topic ? { topic } : {}),
      startedAt: now, endsAt: now + duration, tickAt, ticks, pausedAt: null,
      interruptibility: module.interruptibility, energyCost: module.energyCost, session,
    };
    this.#last = kind;
    host.log.append("activity", { phase: "start", kind, label: this.#current.label, sprite: module.sprite, minutes: Math.round(minutes), endsAt: now + duration, ticks });
  }

  #resume(now: number) {
    const current = this.#current;
    if (!current || current.pausedAt === null) return;
    const paused = now - current.pausedAt;
    current.pausedAt = null;
    current.endsAt += paused;
    current.tickAt = current.tickAt.map((at) => at + paused);
    this.host.log.append("activity", { phase: "resume", kind: current.kind, endsAt: current.endsAt });
  }

  #end(reason: string) {
    const current = this.#current;
    if (!current) return;
    this.#current = null;
    void current.session.end?.(this.host.actionContext(this.#abort.signal, current.topic));
    this.host.log.append("activity", { phase: "end", kind: current.kind, label: current.label, summary: current.summary, reason });
    this.host.activityEnded(current, reason);
  }

  #wake() {
    this.#asleep = false;
    this.host.log.append("sleep", { state: "awake" });
    this.host.wokeUp();
  }

  /** 대화가 시작되면 하던 일을 바로 멈춘다 (점검 주기를 기다리지 않는다). */
  pause() {
    const current = this.#current;
    if (current && current.pausedAt === null) {
      current.pausedAt = this.host.clock.now();
      this.host.log.append("activity", { phase: "pause", kind: current.kind });
    }
  }

  #schedule() {
    const ms = Math.max(2_000, CHECK_MS / Math.max(1, this.host.config.pace));
    this.#timer = this.host.clock.setTimeout(() => {
      void this.check().finally(() => { if (this.#timer) this.#schedule(); });
    }, ms);
  }
}

function between([min, max]: readonly [number, number], random: () => number): number {
  return min + (max - min) * random();
}
