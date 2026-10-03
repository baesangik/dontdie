import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCharacter } from "../src/character/state.js";
import { defaultConfig, PROVIDER_DEFAULTS } from "../src/config.js";
import { ManualClock } from "../src/core/clock.js";
import { EventLog } from "../src/core/eventlog.js";
import { Harness } from "../src/harness.js";
import { Providers } from "../src/providers/index.js";
import { FakeProvider, type FakeResponder } from "../src/providers/fake.js";
import { ProviderError } from "../src/providers/types.js";

function setup(responder: FakeResponder = () => "<think>…</think>\n응") {
  const clock = new ManualClock(Date.UTC(2026, 9, 3, 12));
  const log = new EventLog(null, clock);
  const fake = new FakeProvider(responder);
  const config = defaultConfig();
  config.layers = structuredClone(PROVIDER_DEFAULTS.fake);
  config.pace = 10;
  let saved = 0;
  const harness = new Harness({
    clock, log, config, character: emptyCharacter(),
    providers: new Providers(() => config, "/nonexistent", { fake }),
    saveCharacter: () => { saved++; },
  });
  /** 하네스가 쉴 때까지 시계를 돌린다. */
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      if (!harness.busy) return;
      clock.advance(200);
    }
    throw new Error("harness did not settle");
  };
  const says = () => log.recent(100, ["say"]).map((event) => event.text);
  return { clock, log, fake, harness, settle, says, saved: () => saved };
}

test("데려오면 상황 설명으로 Talker가 깨어나 첫마디를 한다", async () => {
  const { harness, fake, settle, says, saved } = setup();
  fake.queue("<think>여기가 집인가</think>\n…실례합니다");
  assert.equal(harness.adopt(), true);
  assert.equal(harness.adopt(), false, "두 번 데려올 수는 없다");
  await settle();
  assert.deepEqual(says(), ["…실례합니다"]);
  const request = fake.requests[0]!;
  assert.equal(request.messages[0]!.role, "developer");
  assert.match(request.instructions, /주워졌다/);
  assert.ok(saved() >= 1);
});

test("S0: 이름 거절 → 수락, 호칭 거절 → 수락", async () => {
  const { harness, fake, settle, log } = setup();
  harness.adopt();
  await settle();
  fake.queue(
    "<think>개 이름이잖아</think>\n그건 개 이름 아님?\n<refuse_name>뽀삐</refuse_name>",
    "<think>나쁘지 않네</think>\n…그건 괜찮네\n<name>콩이</name>",
    "<think>내가 하인이냐</think>\n싫은데\n<refuse_address>주인님</refuse_address>",
    "<think>ㅇㅋ</think>\nㅇㅋ 형\n<address>형</address>",
  );
  for (const text of ["너 이름 이제부터 뽀삐야", "그럼 콩이", "날 주인님이라고 불러", "그럼 형"]) {
    harness.userMessage(text);
    await settle();
  }
  assert.equal(harness.character.name?.value, "콩이");
  assert.deepEqual(harness.character.rejectedNames.map((entry) => entry.value), ["뽀삐"]);
  assert.equal(harness.character.addressAs?.value, "형");
  assert.deepEqual(harness.character.rejectedAddresses.map((entry) => entry.value), ["주인님"]);
  assert.deepEqual(log.recent(50, ["name_given", "name_refused", "address_set", "address_refused"]).map((event) => event.type),
    ["name_refused", "name_given", "address_refused", "address_set"]);
  // 이름이 생긴 뒤의 요청에는 이름이 들어간다.
  assert.match(fake.requests.at(-1)!.instructions, /지어준 이름: 콩이/);
});

test("생각하는 동안 온 메시지에도 답하고, 기록 순서가 맞다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const { harness, fake, settle, clock } = setup(async (request) => {
    if (request.messages.at(-1)?.role === "developer") return "<think>…</think>\n…";
    calls++;
    if (calls === 1) await gate;
    return `<think>${calls}</think>\n답${calls}`;
  });
  harness.adopt();
  await settle();
  harness.userMessage("첫 번째");
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(200);
  }
  harness.userMessage("두 번째");
  release();
  await settle();
  assert.equal(calls, 2);
  const second = fake.requests.at(-1)!.messages.map((message) => `${message.role}:${message.content.split("\n").pop()}`);
  assert.deepEqual(second.slice(-3), ["user:첫 번째", "assistant:답1", "user:두 번째"], "답은 자기가 답한 메시지 바로 뒤에 온다");
});

test("사용량 한도에 걸리면 오류를 남기고 '머리아파'로 넘긴다", async () => {
  const { harness, fake, settle, log, says } = setup();
  harness.adopt();
  await settle();
  fake.queue(new ProviderError("subscription_sharing_usage_limit_exceeded", "limit", false, 429));
  harness.userMessage("야");
  await settle();
  assert.equal(log.recent(10, ["error"]).at(-1)?.code, "subscription_sharing_usage_limit_exceeded");
  assert.equal(says().at(-1), "아 머리아파. 나중에 얘기해");
  assert.equal(log.recent(10, ["llm_call"]).at(-1)?.ok, false);
});

test("데려오기 전에는 말을 걸 수 없다", () => {
  const { harness } = setup();
  assert.throws(() => harness.userMessage("안녕"), /not_adopted/);
});

test("대화가 끝나면 주의 상태가 winding_down → 15초 뒤 around", async () => {
  const { harness, fake, settle, clock } = setup();
  harness.adopt();
  await settle();
  fake.queue("<think>…</think>\nㅇㅇ");
  harness.attentionSignal("chat_focus");
  harness.userMessage("ㅇㅋ");
  await settle();
  assert.equal(harness.attention.state, "winding_down");
  clock.advance(15_000);
  assert.equal(harness.attention.state, "around");
});

test("로그인 전에 실패하면 메시지를 버리지 않고, 로그인 뒤 resume()으로 이어서 답한다", async () => {
  const { harness, fake, settle, log, says } = setup();
  fake.queue(new ProviderError("sign_in_required", "Sign in with ChatGPT to continue."), "<think>…</think>\n…실례합니다");
  harness.adopt();
  await settle();
  assert.deepEqual(says(), [], "로그인 문제는 대사 없이 배지만");
  assert.equal(log.recent(10, ["error"]).at(-1)?.code, "sign_in_required");
  assert.equal(fake.requests.length, 1, "막힌 상태에서 계속 재시도하지 않는다");
  harness.resume();
  await settle();
  assert.deepEqual(says(), ["…실례합니다"]);
  assert.equal(fake.requests[1]!.messages.at(-1)!.role, "developer", "데려온 상황에 대한 첫마디");
});
