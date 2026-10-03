// 실제 모델로 대화 몇 마디를 돌려보고 내부에서 무슨 일이 일어나는지 찍는다 (개발용).
// 로그인 정보는 data/의 것을 쓰고, 대화와 기억은 data-try/에 따로 둔다. 실행할 때마다 새로 시작한다.
//
//   npm run try -- "너 이름 뭐야?" "이거 완전 킹리적갓심이네" "아니 이걸 몰라? 디시에 쳐봐"
//
// 주의: 메시지 하나에 Router/Talker 호출 2~4번, 검색이나 숙고가 붙으면 Reasoner 호출이 더 든다.

import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptyCharacter } from "../src/character/state.js";
import { DATA_DIR, loadConfig } from "../src/config.js";
import { RealClock } from "../src/core/clock.js";
import { EventLog } from "../src/core/eventlog.js";
import { Harness } from "../src/harness.js";
import { MemoryStore } from "../src/memory/store.js";
import { Providers } from "../src/providers/index.js";

const dir = resolve(DATA_DIR, "..", "data-try");
rmSync(dir, { recursive: true, force: true });
const config = loadConfig();
config.pace = Number(process.env.DONTDIE_PACE ?? 8);
config.life.enabled = false;
const clock = new RealClock();
const log = new EventLog(join(dir, "events.jsonl"), clock);
const memory = new MemoryStore(join(dir, "memory.sqlite"));
const providers = new Providers(() => config, DATA_DIR);
const harness = new Harness({ clock, log, providers, config, character: emptyCharacter(), memory });

const SHOW = new Set(["user_message", "say", "thought", "face", "router", "ladder", "consult", "memory", "revise", "assistantism", "speech", "filler", "error", "llm_call"]);
log.subscribe((event) => {
  if (!SHOW.has(event.type)) return;
  const { id: _id, t: _t, type, ...rest } = event;
  if (type === "user_message") console.log(`\n나: ${rest.text}`);
  else if (type === "say") console.log(`봇: ${rest.text}`);
  else if (type === "llm_call") console.log(`  · ${rest.layer} ${rest.model} ${rest.ms}ms${rest.ok ? "" : ` 실패 ${rest.code}`}`);
  else if (type === "router") {
    const v = rest.verdict as Record<string, unknown>;
    console.log(`  [router${rest.fallback ? ` 규칙(${rest.fallback})` : ""}] ${v.intent} s=${v.salience} stakes=${v.stakes} closure=${v.closure} pressure=${v.pressure} feeling=${v.feeling} unknowns=${JSON.stringify(v.unknowns)} teaching=${JSON.stringify(v.teaching)} search=${JSON.stringify(v.search)} topic=${v.topic} gist=${v.gist}`);
  } else console.log(`  [${type}] ${JSON.stringify(rest).slice(0, 500)}`);
});

async function idle() {
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (;;) {
    await harness.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!harness.busy && harness.jobs.length === 0) return;
  }
}

harness.attentionSignal("chat_focus");
harness.adopt();
await idle();
for (const text of process.argv.slice(2)) {
  harness.attentionSignal("chat_focus");
  harness.userMessage(text);
  await idle();
}

console.log("\n── 기억 ──");
for (const entry of memory.list({ limit: 50 })) console.log(`${entry.kind}\t${entry.key ?? ""}\t${entry.content}\t(${entry.source})`);
console.log("── 할 말 큐 ──");
for (const item of harness.speech.top(clock.now())) console.log(`${item.m.toFixed(2)}\t${item.text}`);
harness.stop();
memory.close();
