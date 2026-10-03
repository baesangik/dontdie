import { NOON, setup } from "./helpers.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderError } from "../src/providers/types.js";

test("데려오면 상황 설명으로 Talker가 깨어나 첫마디를 한다", async () => {
  const { harness, fake, settle, says, saved, talker } = setup();
  fake.queue("<think>여기가 집인가</think>\n…실례합니다");
  assert.equal(harness.adopt(), true);
  assert.equal(harness.adopt(), false, "두 번 데려올 수는 없다");
  await settle();
  assert.deepEqual(says(), ["…실례합니다"]);
  const request = talker()[0]!;
  assert.equal(request.messages[0]!.role, "developer");
  assert.match(request.messages[0]!.content, /데려왔다/);
  assert.match(request.instructions, /주워졌다/);
  assert.equal(fake.requestsFor("router").length, 0, "상황 설명에는 Router를 안 부른다");
  assert.ok(saved() >= 1);
});

test("S0: 이름 거절 → 수락, 호칭 거절 → 수락", async () => {
  const { harness, fake, adopt, say, log, talker, memory } = setup();
  await adopt();
  fake.queue(
    "<think>개 이름이잖아</think>\n그건 개 이름 아님?\n<refuse_name>뽀삐</refuse_name>",
    "<think>나쁘지 않네</think>\n…그건 괜찮네\n<name>콩이</name>",
    "<think>내가 하인이냐</think>\n싫은데\n<refuse_address>주인님</refuse_address>",
    "<think>ㅇㅋ</think>\nㅇㅋ 형\n<address>형</address>",
  );
  for (const text of ["너 이름 이제부터 뽀삐야", "그럼 콩이", "날 주인님이라고 불러", "그럼 형"]) await say(text);
  assert.equal(harness.character.name?.value, "콩이");
  assert.deepEqual(harness.character.rejectedNames.map((entry) => entry.value), ["뽀삐"]);
  assert.equal(harness.character.addressAs?.value, "형");
  assert.deepEqual(harness.character.rejectedAddresses.map((entry) => entry.value), ["주인님"]);
  assert.deepEqual(log.recent(50, ["name_given", "name_refused", "address_set", "address_refused"]).map((event) => event.type),
    ["name_refused", "name_given", "address_refused", "address_set"]);
  // 이름이 생긴 뒤의 요청에는 이름이 들어간다.
  assert.match(talker().at(-1)!.instructions, /지어준 이름: 콩이/);
  // 정체성 변화는 자기 기억에 남는다 (거절한 후보 포함).
  assert.ok(memory.list({ kinds: ["self"] }).some((entry) => /콩이/.test(entry.content) && /뽀삐/.test(entry.content)));
});

test("생각하는 동안 온 메시지에도 답하고, 기록 순서가 맞다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const { harness, settle, clock, talker } = setup({
    responder: async (request) => {
      if (request.messages.filter((message) => message.role !== "developer").length === 0) return "<think>…</think>\n…";
      calls++;
      if (calls === 1) await gate;
      return `<think>${calls}</think>\n답${calls}`;
    },
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
  const second = talker().at(-1)!.messages.filter((message) => !/^\[지금\]/.test(message.content)).map((message) => `${message.role}:${message.content.split("\n").pop()}`);
  assert.deepEqual(second.slice(-3), ["user:첫 번째", "assistant:답1", "user:두 번째"], "답은 자기가 답한 메시지 바로 뒤에 온다");
});

test("사용량 한도에 걸리면 오류를 남기고 '머리아파'로 넘긴다", async () => {
  const { fake, adopt, say, log, says } = setup();
  await adopt();
  fake.queue(new ProviderError("subscription_sharing_usage_limit_exceeded", "limit", false, 429));
  await say("야");
  assert.equal(log.recent(10, ["error"]).at(-1)?.code, "subscription_sharing_usage_limit_exceeded");
  assert.equal(says().at(-1), "아 머리아파. 나중에 얘기해");
  assert.equal(log.recent(10, ["llm_call"]).at(-1)?.ok, false);
});

test("데려오기 전에는 말을 걸 수 없다", () => {
  const { harness } = setup();
  assert.throws(() => harness.userMessage("안녕"), /not_adopted/);
});

test("대화가 끝나면 주의 상태가 winding_down → 15초 뒤 around", async () => {
  const { harness, fake, adopt, settle, clock } = setup();
  await adopt();
  fake.queue("<think>…</think>\nㅇㅇ");
  harness.attentionSignal("chat_focus");
  harness.userMessage("ㅇㅋ");
  await settle();
  assert.equal(harness.attention.state, "winding_down");
  clock.advance(15_000);
  assert.equal(harness.attention.state, "around");
});

test("로그인 전에 실패하면 메시지를 버리지 않고, 로그인 뒤 resume()으로 이어서 답한다", async () => {
  const { harness, fake, settle, log, says, talker } = setup();
  fake.queue(new ProviderError("sign_in_required", "Sign in with ChatGPT to continue."), "<think>…</think>\n…실례합니다");
  harness.adopt();
  await settle();
  assert.deepEqual(says(), [], "로그인 문제는 대사 없이 배지만");
  assert.equal(log.recent(10, ["error"]).at(-1)?.code, "sign_in_required");
  assert.equal(talker().length, 1, "막힌 상태에서 계속 재시도하지 않는다");
  harness.resume();
  await settle();
  assert.deepEqual(says(), ["…실례합니다"]);
  assert.match(talker()[1]!.messages[0]!.content, /데려왔다/, "데려온 상황에 대한 첫마디");
});

test("Router가 실패하면 규칙 판정으로 넘어가고 대화는 이어진다", async () => {
  const { fake, adopt, say, says, events } = setup();
  await adopt();
  // 일시적인 실패는 한 번 더 해보고, 그래도 안 되면 규칙으로 간다.
  fake.queueFor("router", new ProviderError("http_500", "boom", true, 500), new ProviderError("http_500", "boom again", true, 500));
  fake.queue("<think>…</think>\n응 잘자");
  await say("나 잘게");
  const router = events("router").at(-1)!;
  assert.equal(router.fallback, "http_500");
  assert.equal((router.verdict as { leaving: boolean }).leaving, true, "규칙으로도 '잘게'는 떠나는 걸로 잡는다");
  assert.equal(says().at(-1), "응 잘자");
  assert.equal(fake.requestsFor("router").length, 2);
});

test("시작 시각은 정오(UTC)다", () => {
  assert.equal(new Date(NOON).getHours(), 12);
});
