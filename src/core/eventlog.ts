// 추가만 하는 이벤트 로그. 리플레이, 관전 모드, 디버깅의 단일 출처다.
// 자격 증명이나 토큰은 절대 넣지 않는다.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Clock } from "./clock.js";

export interface LogEvent {
  id: number;
  t: number;
  type: string;
  [key: string]: unknown;
}

type Listener = (event: LogEvent) => void;

const TAIL_SIZE = 1000;

export class EventLog {
  #nextId = 1;
  #tail: LogEvent[] = [];
  #listeners = new Set<Listener>();

  /** file이 null이면 메모리에만 둔다 (테스트). */
  constructor(private readonly file: string | null, private readonly clock: Clock) {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as LogEvent;
        this.#tail.push(event);
        this.#nextId = Math.max(this.#nextId, event.id + 1);
      } catch {
        // 깨진 줄은 건너뛴다. 로그는 추가만 하므로 마지막 줄만 깨질 수 있다.
      }
    }
    this.#tail = this.#tail.slice(-TAIL_SIZE);
  }

  append(type: string, payload: Record<string, unknown> = {}): LogEvent {
    const event: LogEvent = { ...payload, id: this.#nextId++, t: this.clock.now(), type };
    if (this.file) appendFileSync(this.file, JSON.stringify(event) + "\n");
    this.#tail.push(event);
    if (this.#tail.length > TAIL_SIZE * 2) this.#tail = this.#tail.slice(-TAIL_SIZE);
    for (const listener of this.#listeners) {
      try { listener(event); } catch { /* 구독자가 로그 기록을 막으면 안 된다 */ }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** 최근 이벤트. types를 주면 그 종류만. */
  recent(limit: number, types?: readonly string[]): LogEvent[] {
    const events = types ? this.#tail.filter((event) => types.includes(event.type)) : this.#tail;
    return events.slice(-limit);
  }
}
