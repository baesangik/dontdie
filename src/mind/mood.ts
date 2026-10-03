// 기분 (valence, arousal)과 짧게 남는 감정 단어. 시간이 지나면 기준선으로 돌아간다.
// 하네스가 계산하고, Talker는 상태 줄로 보고 연기만 한다.

import type { Language } from "../config.js";
import type { MemoryStore } from "../memory/store.js";
import type { Verdict } from "./verdict.js";

const BASELINE = { valence: 0.05, arousal: 0.3 };
const MOOD_HALF_LIFE = 45 * 60_000;
const FEELING_HALF_LIFE = 20 * 60_000;
const KEY = "mood";

export interface MoodState {
  valence: number;
  arousal: number;
  at: number;
  feelings: { word: string; intensity: number; at: number }[];
}

export class Mood {
  #state: MoodState;

  constructor(private readonly store: MemoryStore | null, now: number) {
    this.#state = store?.getValue<MoodState>(KEY) ?? { ...BASELINE, at: now, feelings: [] };
  }

  /** 지금 기분 (기준선으로 감쇠한 값). */
  current(now: number): MoodState {
    const k = Math.pow(0.5, Math.max(0, now - this.#state.at) / MOOD_HALF_LIFE);
    return {
      valence: BASELINE.valence + (this.#state.valence - BASELINE.valence) * k,
      arousal: BASELINE.arousal + (this.#state.arousal - BASELINE.arousal) * k,
      at: now,
      feelings: this.#state.feelings
        .map((feeling) => ({ ...feeling, intensity: feeling.intensity * Math.pow(0.5, Math.max(0, now - feeling.at) / FEELING_HALF_LIFE), at: now }))
        .filter((feeling) => feeling.intensity >= 0.12),
    };
  }

  /** Router 판정의 감정 자극을 더한다. 중요한 일일수록 크게 흔들린다. */
  apply(verdict: Verdict, now: number) {
    const current = this.current(now);
    const weight = 0.35 + 0.45 * verdict.salience;
    current.valence = clamp(current.valence + verdict.valence * weight, -1, 1);
    current.arousal = clamp(current.arousal + (verdict.arousal - BASELINE.arousal) * weight, 0, 1);
    if (verdict.feeling) {
      const intensity = clamp(Math.max(Math.abs(verdict.valence), verdict.arousal) * weight + 0.2, 0, 1);
      current.feelings = [...current.feelings.filter((feeling) => feeling.word !== verdict.feeling), { word: verdict.feeling, intensity, at: now }].slice(-4);
    }
    this.#set(current);
  }

  /** 직접 감정을 넣는다 (예: 검색에 실패해서 시무룩). */
  feel(word: string, valence: number, now: number) {
    const current = this.current(now);
    current.valence = clamp(current.valence + valence, -1, 1);
    current.feelings = [...current.feelings.filter((feeling) => feeling.word !== word), { word, intensity: 0.5, at: now }].slice(-4);
    this.#set(current);
  }

  /** 자고 일어나면 기분이 리셋된다. */
  reset(now: number) {
    this.#set({ ...BASELINE, at: now, feelings: [] });
  }

  describe(now: number, language: Language): string | null {
    const mood = this.current(now);
    const parts: string[] = [];
    const ko = language === "ko";
    if (mood.valence > 0.35) parts.push(ko ? "기분 좋음" : "in a good mood");
    else if (mood.valence < -0.35) parts.push(ko ? "기분 별로" : "in a bad mood");
    if (mood.arousal > 0.7) parts.push(ko ? "흥분함" : "worked up");
    else if (mood.arousal < 0.15) parts.push(ko ? "축 처짐" : "low-key");
    const strongest = [...mood.feelings].sort((a, b) => b.intensity - a.intensity)[0];
    if (strongest) parts.push(strongest.intensity > 0.45 ? strongest.word : ko ? `조금 ${strongest.word}` : `a bit ${strongest.word}`);
    return parts.length ? parts.join(", ") : null;
  }

  #set(state: MoodState) {
    this.#state = state;
    this.store?.setValue(KEY, state);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
