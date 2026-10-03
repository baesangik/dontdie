// 주의 상태 머신 (MECHANISMS §15). LLM 호출 없이 UI 신호와 규칙만으로 판정한다.
//
// away ⇄ around ⇄ attending (쳐다봄) → engaged (대화 중) → winding_down → around

import type { Cancel, Clock } from "./clock.js";

export type AttentionState = "away" | "around" | "attending" | "engaged" | "winding_down";
export type AttentionSignal = "visible" | "hidden" | "focus" | "blur" | "chat_focus" | "typing" | "sent";

export interface AttentionConfig {
  attendIdleSec: number;
  closureIdleSec: number;
  openIdleSec: number;
  awayAfterMin: number;
  greetAfterMin: number;
}

export const DEFAULT_ATTENTION: AttentionConfig = {
  attendIdleSec: 20,
  closureIdleSec: 15,
  openIdleSec: 90,
  awayAfterMin: 10,
  greetAfterMin: 30,
};

export const CLOSURE_THRESHOLD = 0.6;

export interface AttentionChange {
  from: AttentionState;
  to: AttentionState;
  reason: string;
  /** away에서 돌아왔을 때만: 비운 시간 */
  awayMs?: number;
  /** 비운 시간이 greetAfterMin 이상이면 귀가 인사 후보 */
  greet?: boolean;
}

export class Attention {
  #state: AttentionState = "around";
  #visible = true;
  #focused = true;
  #idleTimer: Cancel | null = null;
  #awayTimer: Cancel | null = null;
  #awaySince: number | null = null;

  constructor(
    private readonly clock: Clock,
    private readonly config: AttentionConfig,
    private readonly onChange: (change: AttentionChange) => void,
  ) {}

  get state() { return this.#state; }

  signal(signal: AttentionSignal) {
    switch (signal) {
      case "visible":
      case "focus":
        if (signal === "visible") this.#visible = true; else this.#focused = true;
        if (this.#visible && this.#focused) {
          this.#cancelAway();
          if (this.#state === "away") this.#to("around", "return");
        }
        return;
      case "hidden":
      case "blur":
        if (signal === "hidden") this.#visible = false; else this.#focused = false;
        this.#scheduleAway();
        return;
      case "chat_focus":
        this.#visible = this.#focused = true;
        this.#cancelAway();
        if (this.#state === "away" || this.#state === "around") {
          this.#to("attending", "chat_focus");
          this.#arm(this.config.attendIdleSec * 1000, "around", "attend_idle");
        }
        return;
      case "typing":
        this.#cancelAway();
        if (this.#state === "away" || this.#state === "around") this.#to("attending", "typing");
        if (this.#state === "attending") this.#arm(this.config.attendIdleSec * 1000, "around", "attend_idle");
        else {
          if (this.#state === "winding_down") this.#to("engaged", "typing");
          this.#arm(this.config.openIdleSec * 1000, "around", "fizzle");
        }
        return;
      case "sent":
        this.#cancelAway();
        this.#clearIdle();
        if (this.#state !== "engaged") this.#to("engaged", "sent");
        return;
    }
  }

  /** 봇이 답을 마쳤다 (침묵으로 넘긴 경우 포함). */
  botReplied(info: { closure: number; expectsReply: boolean }) {
    if (this.#state !== "engaged") return;
    if (info.closure >= CLOSURE_THRESHOLD && !info.expectsReply) {
      this.#to("winding_down", "closure");
      this.#arm(this.config.closureIdleSec * 1000, "around", "closure_idle");
    } else {
      this.#arm(this.config.openIdleSec * 1000, "around", info.expectsReply ? "fizzle_unanswered" : "fizzle");
    }
  }

  /** "나갔다 올게" 류. 봇이 인사한 뒤에 부른다. */
  leaving() {
    this.#clearIdle();
    this.#cancelAway();
    if (this.#state !== "away") this.#to("away", "leaving");
  }

  dispose() {
    this.#clearIdle();
    this.#cancelAway();
  }

  #to(next: AttentionState, reason: string) {
    const from = this.#state;
    if (from === next) return;
    if (next !== "attending" && next !== "engaged" && next !== "winding_down") this.#clearIdle();
    const change: AttentionChange = { from, to: next, reason };
    if (from === "away" && this.#awaySince !== null) {
      change.awayMs = this.clock.now() - this.#awaySince;
      change.greet = change.awayMs >= this.config.greetAfterMin * 60_000;
      this.#awaySince = null;
    }
    if (next === "away") this.#awaySince = this.clock.now();
    this.#state = next;
    this.onChange(change);
  }

  #arm(ms: number, next: AttentionState, reason: string) {
    this.#clearIdle();
    this.#idleTimer = this.clock.setTimeout(() => {
      this.#idleTimer = null;
      this.#to(next, reason);
      // 창이 이미 숨겨진 채로 대화가 끝났으면, 부재 타이머를 다시 건다.
      if (!this.#visible || !this.#focused) this.#scheduleAway();
    }, ms);
  }

  #clearIdle() {
    this.#idleTimer?.();
    this.#idleTimer = null;
  }

  #scheduleAway() {
    if (this.#awayTimer || this.#state === "away") return;
    this.#awayTimer = this.clock.setTimeout(() => {
      this.#awayTimer = null;
      if (!this.#visible || !this.#focused) this.#to("away", "away_idle");
    }, this.config.awayAfterMin * 60_000);
  }

  #cancelAway() {
    this.#awayTimer?.();
    this.#awayTimer = null;
  }
}

// ── 규칙 기반 판정 (Router가 생기기 전의 대체 구현, 이후에도 테스트용으로 유지) ──

const ACK: Record<string, string[]> = {
  ko: ["ㅇㅋ", "ㅇㅋㅇㅋ", "ㅇㅇ", "ㄱㅅ", "ㄳ", "ㄱㅊ", "굿", "오케이", "오키", "알겠어", "알았어", "알겠음", "그래", "그래그래", "응", "웅", "넵", "네", "넹", "고마워", "고마워요", "땡큐", "잘자", "잘 자", "ㅂㅂ", "ㅂㅇ", "바이", "수고", "ok", "ㅇㅋㄷㅋ"],
  en: ["ok", "okay", "k", "kk", "thanks", "thx", "ty", "bye", "gn", "good night", "cool", "nice", "got it", "sure", "lol", "np"],
};

const LEAVING: Record<string, RegExp> = {
  ko: /(나갔다\s*올게|다녀올게|갔다\s*올게|잠깐\s*나갈게|나\s*간다|자러\s*갈게|잘게|씻고\s*올게|밥\s*먹고\s*올게|이따\s*봐|ㅂㅂ$)/,
  en: /\b(brb|gotta go|be right back|heading out|going to bed|see you later|cya|ttyl)\b/i,
};

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[.!~?,…\s]+$/u, "").replace(/^[.!~?,…\s]+/u, "");
}

/** 대화가 끝났을 가능성 0..1. */
export function ruleClosure(text: string, language: string): number {
  const normalized = normalize(text);
  if (!normalized) return 0.5;
  if (/^[ㅋㅎ]+$/u.test(normalized)) return 0.8;
  const acks = ACK[language] ?? ACK.en!;
  if (acks.includes(normalized)) return 0.85;
  if (LEAVING[language]?.test(normalized)) return 0.9;
  return [...normalized].length <= 3 ? 0.3 : 0.1;
}

export function ruleLeaving(text: string, language: string): boolean {
  return (LEAVING[language] ?? LEAVING.en!).test(normalize(text));
}

/** 봇이 질문을 던졌는가. */
export function expectsReply(bubbles: readonly string[]): boolean {
  const last = bubbles[bubbles.length - 1]?.trim() ?? "";
  return /[?？]\s*$/u.test(last);
}
