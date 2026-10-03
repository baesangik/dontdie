import assert from "node:assert/strict";
import { test } from "node:test";
import { HALF_LIFE, MemoryStore, strength } from "../src/memory/store.js";
import { mentions } from "../src/memory/text.js";

const DAY = 86_400_000;

test("기억은 시간이 지나면 약해지고, 꺼내 쓰면 강해진다", () => {
  const store = new MemoryStore(":memory:");
  const memory = store.add({ kind: "episode", content: "이 집 사람이 내일 면접 봄", source: "user", importance: 0.6 }, 0);
  assert.equal(strength(memory, 0), 0.6);
  assert.ok(Math.abs(strength(memory, HALF_LIFE.episode) - 0.3) < 1e-9, "반감기가 지나면 절반");
  store.touch([memory.id], 2 * DAY);
  const touched = store.get(memory.id)!;
  assert.equal(touched.uses, 1);
  assert.ok(strength(touched, 2 * DAY) > 0.6, "꺼내 쓰면 생생해진다");
});

test("약해진 기억은 잊히지만 지워지지는 않는다", () => {
  const store = new MemoryStore(":memory:");
  const weak = store.add({ kind: "scratch", content: "방금 본 기사 제목", source: "activity", importance: 0.3 }, 0);
  const strong = store.add({ kind: "person", key: "민수", content: "회사 동기", source: "user", importance: 0.8 }, 0);
  const diary = store.add({ kind: "diary", content: "오늘 이름을 받았다", source: "self", importance: 1 }, 0);
  const forgotten = store.forgetWeak(DAY);
  assert.deepEqual(forgotten.map((memory) => memory.id), [weak.id]);
  assert.equal(store.list({ kinds: ["scratch"] }).length, 0, "검색 대상에서 빠진다");
  assert.equal(store.list({ onlyForgotten: true }).length, 1, "잊힌 기억 목록에는 남는다");
  assert.ok(store.get(strong.id)!.forgottenAt === null);
  assert.ok(store.forgetWeak(1000 * DAY).every((memory) => memory.id !== diary.id), "일기는 잊지 않는다");
});

test("같은 사람에 대한 사실은 하나로 합친다", () => {
  const store = new MemoryStore(":memory:");
  const first = store.upsertFact({ kind: "person", key: "민수", content: "이 집 사람의 회사 동기", source: "user", importance: 0.8 }, 0);
  assert.equal(first.created, true);
  const again = store.upsertFact({ kind: "person", key: "민수", content: "이 집 사람의 회사 동기", source: "user" }, 1000);
  assert.equal(again.created, false);
  assert.equal(again.memory.content, "이 집 사람의 회사 동기", "같은 사실은 덧붙이지 않는다");
  const more = store.upsertFact({ kind: "person", key: "민수", content: "맨날 의자를 가져감", source: "user" }, 2000);
  assert.equal(more.memory.content, "이 집 사람의 회사 동기 / 맨날 의자를 가져감");
  assert.equal(more.memory.uses, 2);
  assert.equal(store.findByKey(["person"], "민수")!.id, first.memory.id);
});

test("검색은 이름 언급과 내용 겹침을 보고, 생생한 기억을 앞에 둔다", () => {
  const store = new MemoryStore(":memory:");
  store.add({ kind: "person", key: "민수", content: "이 집 사람의 회사 동기", source: "user", importance: 0.8 }, 0);
  store.add({ kind: "episode", content: "이 집 사람이 회사에서 야근함", source: "user", importance: 0.5 }, 0);
  store.add({ kind: "knowledge", key: "킹리적갓심", content: "합리적 의심을 과장한 말", source: "search", importance: 0.6 }, 0);
  const results = store.search("민수가 오늘 휴가래", DAY);
  assert.equal(results[0]!.key, "민수");
  assert.ok(!results.some((memory) => memory.key === "킹리적갓심"));
  const work = store.search("회사 일 힘들다", DAY);
  assert.ok(work.length >= 1);
});

test("조사가 붙어도 이름을 알아보고, 영단어는 단어 경계를 본다", () => {
  assert.equal(mentions("민수가 또 그 짓 함", "민수"), true);
  assert.equal(mentions("민수는 휴가", "민수"), true);
  assert.equal(mentions("I like art", "art"), true);
  assert.equal(mentions("let's start", "art"), false);
});

test("주제 반복과 하루 사용량을 센다", () => {
  const store = new MemoryStore(":memory:");
  for (const at of [0, DAY, 2 * DAY, 8 * DAY]) store.recordTopic("퇴사", at);
  assert.equal(store.topicCount("퇴사", 8 * DAY - 7 * DAY), 3);
  store.addUsage("2026-10-03", "talker");
  store.addUsage("2026-10-03", "talker");
  assert.deepEqual(store.usage("2026-10-03"), { talker: 2 });
  store.setValue("x", { a: 1 });
  assert.deepEqual(store.getValue("x"), { a: 1 });
});
