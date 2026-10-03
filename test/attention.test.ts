import assert from "node:assert/strict";
import { test } from "node:test";
import { Attention, DEFAULT_ATTENTION, expectsReply, ruleClosure, ruleLeaving, type AttentionChange } from "../src/core/attention.js";
import { ManualClock } from "../src/core/clock.js";

function setup() {
  const clock = new ManualClock(0);
  const changes: AttentionChange[] = [];
  const attention = new Attention(clock, DEFAULT_ATTENTION, (change) => changes.push(change));
  return { clock, changes, attention };
}

test("S10: 채팅창을 누르면 쳐다보고, 20초 동안 아무것도 안 하면 하던 일로 돌아간다", () => {
  const { clock, attention, changes } = setup();
  attention.signal("chat_focus");
  assert.equal(attention.state, "attending");
  clock.advance(19_000);
  assert.equal(attention.state, "attending");
  clock.advance(1_000);
  assert.equal(attention.state, "around");
  assert.equal(changes.at(-1)?.reason, "attend_idle");
});

test("S10: 대화가 끝난 것 같으면 15초 뒤 하던 일로 돌아간다", () => {
  const { clock, attention } = setup();
  attention.signal("chat_focus");
  attention.signal("sent");
  assert.equal(attention.state, "engaged");
  clock.advance(60_000);
  assert.equal(attention.state, "engaged", "봇이 답하기 전에는 기다린다");
  attention.botReplied({ closure: 0.85, expectsReply: false });
  assert.equal(attention.state, "winding_down");
  clock.advance(14_000);
  assert.equal(attention.state, "winding_down");
  clock.advance(1_000);
  assert.equal(attention.state, "around");
});

test("winding_down 중에 타이핑하면 다시 대화로 돌아온다", () => {
  const { clock, attention } = setup();
  attention.signal("sent");
  attention.botReplied({ closure: 0.9, expectsReply: false });
  clock.advance(10_000);
  attention.signal("typing");
  assert.equal(attention.state, "engaged");
  clock.advance(10_000);
  assert.equal(attention.state, "engaged", "closure 타이머는 취소된다");
});

test("봇이 질문을 던졌으면 closure가 높아도 90초 기다린다", () => {
  const { clock, attention, changes } = setup();
  attention.signal("sent");
  attention.botReplied({ closure: 0.9, expectsReply: true });
  assert.equal(attention.state, "engaged");
  clock.advance(89_000);
  assert.equal(attention.state, "engaged");
  clock.advance(1_000);
  assert.equal(attention.state, "around");
  assert.equal(changes.at(-1)?.reason, "fizzle_unanswered");
});

test("창을 숨기고 10분이 지나면 부재, 30분 넘게 비웠다 돌아오면 귀가 인사 후보", () => {
  const { clock, attention, changes } = setup();
  attention.signal("hidden");
  clock.advance(9 * 60_000);
  assert.equal(attention.state, "around");
  clock.advance(60_000);
  assert.equal(attention.state, "away");
  clock.advance(25 * 60_000);
  attention.signal("visible");
  const back = changes.at(-1)!;
  assert.equal(back.to, "around");
  assert.equal(back.reason, "return");
  assert.equal(back.awayMs, 25 * 60_000);
  assert.equal(back.greet, false, "부재 시간은 away가 된 시점부터 센다 (25분 < 30분)");
  attention.signal("hidden");
  clock.advance(10 * 60_000 + 31 * 60_000);
  attention.signal("visible");
  assert.equal(changes.at(-1)!.greet, true);
});

test("짧게 비웠다 오면 인사하지 않는다", () => {
  const { clock, attention, changes } = setup();
  attention.signal("blur");
  clock.advance(11 * 60_000);
  assert.equal(attention.state, "away");
  attention.signal("chat_focus");
  assert.equal(attention.state, "attending");
  const back = changes.find((change) => change.from === "away")!;
  assert.equal(back.greet, false);
});

test("창이 다시 보이면 부재 타이머가 취소된다", () => {
  const { clock, attention } = setup();
  attention.signal("hidden");
  clock.advance(5 * 60_000);
  attention.signal("visible");
  clock.advance(10 * 60_000);
  assert.equal(attention.state, "around");
});

test("나갔다 올게 → 바로 부재", () => {
  const { attention } = setup();
  attention.signal("sent");
  attention.leaving();
  assert.equal(attention.state, "away");
});

test("규칙 기반 closure / leaving / expectsReply", () => {
  assert.ok(ruleClosure("ㅇㅋ", "ko") >= 0.6);
  assert.ok(ruleClosure("ㅋㅋㅋㅋ", "ko") >= 0.6);
  assert.ok(ruleClosure("고마워!", "ko") >= 0.6);
  assert.ok(ruleClosure("근데 그거 어떻게 하는 건데", "ko") < 0.6);
  assert.ok(ruleClosure("thanks", "en") >= 0.6);
  assert.equal(ruleLeaving("나 잠깐 나갔다 올게", "ko"), true);
  assert.equal(ruleLeaving("brb", "en"), true);
  assert.equal(ruleLeaving("밥 뭐 먹지", "ko"), false);
  assert.equal(expectsReply(["음", "그게 뭔데?"]), true);
  assert.equal(expectsReply(["그렇구나"]), false);
});
