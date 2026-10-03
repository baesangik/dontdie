// 모든 타이머는 Clock을 거친다. 실시간, 배속, 수동 진행(테스트)을 바꿔 끼울 수 있다.

export type Cancel = () => void;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Cancel;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function sleepWith(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const cancel = clock.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      cancel();
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class RealClock implements Clock {
  now() { return Date.now(); }
  setTimeout(fn: () => void, ms: number): Cancel {
    const handle = setTimeout(fn, Math.max(0, ms));
    return () => clearTimeout(handle);
  }
  sleep(ms: number, signal?: AbortSignal) { return sleepWith(this, ms, signal); }
}

/** 시간이 speed배 빠르게 흐른다. now()도 같이 빨라진다. */
export class WarpClock implements Clock {
  readonly #start = Date.now();
  constructor(readonly speed: number, readonly origin = Date.now()) {
    if (!(speed > 0)) throw new Error("speed must be positive");
  }
  now() { return this.origin + (Date.now() - this.#start) * this.speed; }
  setTimeout(fn: () => void, ms: number): Cancel {
    const handle = setTimeout(fn, Math.max(0, ms / this.speed));
    return () => clearTimeout(handle);
  }
  sleep(ms: number, signal?: AbortSignal) { return sleepWith(this, ms, signal); }
}

/** 테스트용. advance()를 불러야 시간이 흐른다. */
export class ManualClock implements Clock {
  #t: number;
  #seq = 0;
  #timers: { at: number; seq: number; fn: () => void }[] = [];
  constructor(start = 0) { this.#t = start; }
  now() { return this.#t; }
  setTimeout(fn: () => void, ms: number): Cancel {
    const timer = { at: this.#t + Math.max(0, ms), seq: this.#seq++, fn };
    this.#timers.push(timer);
    return () => { this.#timers = this.#timers.filter((entry) => entry !== timer); };
  }
  sleep(ms: number, signal?: AbortSignal) { return sleepWith(this, ms, signal); }
  /** 시간을 ms만큼 진행하면서, 도래한 타이머를 순서대로 실행한다. */
  advance(ms: number) {
    const target = this.#t + ms;
    for (;;) {
      const due = this.#timers
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.#timers = this.#timers.filter((timer) => timer !== due);
      this.#t = due.at;
      due.fn();
    }
    this.#t = target;
  }
  get pending() { return this.#timers.length; }
}
