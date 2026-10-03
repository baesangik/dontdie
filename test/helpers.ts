// 시나리오 테스트 공통 준비물: 수동 시계 + fake provider + 메모리 SQLite.
process.env.TZ = "UTC";

import { ActionRegistry } from "../src/actions/registry.js";
import { emptyCharacter } from "../src/character/state.js";
import { defaultConfig, PROVIDER_DEFAULTS, type Config } from "../src/config.js";
import { ManualClock } from "../src/core/clock.js";
import { EventLog } from "../src/core/eventlog.js";
import { Harness } from "../src/harness.js";
import { MemoryStore } from "../src/memory/store.js";
import { FakeProvider, type FakeResponder } from "../src/providers/fake.js";
import { Providers } from "../src/providers/index.js";

/** 2026-10-03 12:00 UTC (토요일 정오). 일기 시간도, 잘 시간도 아니다. */
export const NOON = Date.UTC(2026, 9, 3, 12);

export interface SetupOptions {
  responder?: FakeResponder;
  /** 기본 0.5: 확률 분기를 고정한다 */
  random?: () => number;
  actions?: ActionRegistry;
  start?: number;
  configure?: (config: Config) => void;
}

export function setup(options: SetupOptions = {}) {
  const clock = new ManualClock(options.start ?? NOON);
  const log = new EventLog(null, clock);
  const fake = new FakeProvider(options.responder ?? (() => "<think>…</think>\n응"));
  const memory = new MemoryStore(":memory:");
  const config = defaultConfig();
  config.layers = structuredClone(PROVIDER_DEFAULTS.fake);
  config.pace = 10;
  config.life.enabled = false;
  options.configure?.(config);
  let saved = 0;
  const harness = new Harness({
    clock, log, config, memory, character: emptyCharacter(),
    providers: new Providers(() => config, "/nonexistent", { fake }),
    random: options.random ?? (() => 0.5),
    ...(options.actions ? { actions: options.actions } : {}),
    saveCharacter: () => { saved++; },
  });

  /** 하네스와 Reasoner 작업이 다 끝날 때까지 시계를 돌린다. */
  const settle = async (maxSteps = 600) => {
    for (let i = 0; i < maxSteps; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!harness.busy && harness.jobs.length === 0) {
        // 끝난 작업이 트리거를 남겼을 수 있다. 한 번 더 확인한다.
        await new Promise((resolve) => setImmediate(resolve));
        if (!harness.busy && harness.jobs.length === 0) return;
      }
      clock.advance(200);
    }
    throw new Error("harness did not settle");
  };

  /** 시계를 ms만큼 조금씩 돌린다 (타이머와 비동기 작업이 섞여 있을 때). */
  const run = async (ms: number, step = 1000) => {
    for (let passed = 0; passed < ms; passed += step) {
      clock.advance(Math.min(step, ms - passed));
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
    }
    await settle();
  };

  const says = () => log.recent(500, ["say"]).map((event) => String(event.text));
  const talker = () => fake.requestsFor("talker");
  /** Talker 요청마다 끝에 붙은 "[지금]" 블록 */
  const contexts = () => talker().map((request) => request.messages.filter((message) => message.role === "developer" && /^\[(지금|Now)\]/.test(message.content)).at(-1)?.content ?? "");
  const events = (type: string) => log.recent(1000, [type]);

  const say = async (text: string) => {
    harness.userMessage(text);
    await settle();
  };

  const adopt = async (firstLine = "<think>…</think>\n…실례합니다") => {
    fake.queue(firstLine);
    harness.adopt();
    await settle();
  };

  return { clock, log, fake, memory, config, harness, settle, run, says, talker, contexts, events, say, adopt, saved: () => saved };
}

export function verdict(partial: Record<string, unknown>): string {
  return JSON.stringify({
    salience: 0.5, valence: 0, arousal: 0.3, feeling: null, intent: "chat", closure: 0.1, leaving: false, stakes: "low",
    unknowns: [], teaching: [], pressure: "none", search: { requested: false, query: null, hint: null },
    topic: null, gist: null, importance: 0,
    ...partial,
  });
}
