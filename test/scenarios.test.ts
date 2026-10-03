// MECHANISMS.md의 시나리오를 수동 시계 + fake provider로 재현한다.
import { setup, verdict } from "./helpers.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ActionRegistry, BUILTIN_ACTIONS } from "../src/actions/registry.js";

const DAY = 86_400_000;

test("S1: 모르는 사람 이름 → 물어봄 → 배움 → 사흘 뒤에도 기억", async () => {
  const { fake, adopt, say, contexts, memory, clock, events } = setup();
  await adopt();

  fake.queueFor("router", verdict({ unknowns: [{ term: "민수", kind: "person", known: 0, guess: null }], salience: 0.6 }));
  fake.queue("<think>민수? 누구지</think>\n민수가 누군데");
  await say("아 오늘 민수가 또 그 짓 함");
  assert.match(contexts().at(-1)!, /'민수'가 누군지 모른다/);
  assert.equal(memory.findByKey(["question"], "민수")?.meta.stage, "asked");

  fake.queueFor("router", verdict({ intent: "teaching", teaching: [{ term: "민수", kind: "person", fact: "이 집 사람의 회사 동기. 맨날 이 집 사람 의자를 가져감" }] }));
  fake.queue("<think>ㅋㅋ</think>\nㅋㅋ 왜 그러는 거임");
  await say("회사 동기. 맨날 내 의자 가져감");
  const person = memory.findByKey(["person"], "민수");
  assert.match(person!.content, /회사 동기/);
  assert.equal(person!.source, "user");
  assert.equal(memory.findByKey(["question"], "민수"), undefined, "답을 들으면 질문은 닫힌다");
  assert.ok(events("memory").some((event) => event.op === "learned" && event.key === "민수"));

  clock.advance(3 * DAY);
  // Router가 "모르는 사람"이라고 해도, 기억에 있으면 사다리는 '기억남'으로 간다.
  fake.queueFor("router", verdict({ unknowns: [{ term: "민수", kind: "person", known: 0, guess: null }] }));
  fake.queue("<think>의자 사건의 그 민수</think>\n의자 지켰네");
  await say("민수 오늘 휴가임");
  const context = contexts().at(-1)!;
  assert.match(context, /\[떠오른 기억\]\n- 민수: 이 집 사람의 회사 동기/);
  assert.match(context, /이 집 사람이 알려줌, 3일 전/);
  assert.doesNotMatch(context, /누군지 모른다/);
  assert.equal(events("ladder").at(-1)!.steps instanceof Array && (events("ladder").at(-1)!.steps as { stage: string }[])[0]!.stage, "remembered");
});

test("S1b: 신조어 → 물어봄 → '이걸 몰라? 디시에 쳐봐' → 검색 → 배운 걸로 반응", async () => {
  const { fake, adopt, say, contexts, memory, events, says, harness } = setup();
  await adopt();
  harness.attentionSignal("chat_focus");

  fake.queueFor("router", verdict({ unknowns: [{ term: "킹리적갓심", kind: "slang", known: 0.15, guess: null }], salience: 0.5 }));
  fake.queue("<think>뭔 소리지</think>\n킹리적갓심이 뭔데");
  await say("이거 완전 킹리적갓심이네");
  assert.match(contexts().at(-1)!, /'킹리적갓심'가 뭔지 정확히 모른다.*바로 검색하지는 마/);
  assert.equal(fake.requestsFor("reasoner").length, 0, "모른다고 바로 검색하지 않는다");

  fake.queueFor("router", verdict({ intent: "tease", pressure: "scoff", valence: -0.4, feeling: "민망", search: { requested: true, query: null, hint: "dcinside" } }));
  fake.queue("<think>아 쪽팔려</think>\n아 나 그런 거 안 봄\n잠깐만\n<face>embarrassed</face>\n<consult>킹리적갓심</consult>");
  fake.queueFor("reasoner", JSON.stringify({ found: true, answer: "'킹리적 갓심'은 합리적 의심을 과장한 인터넷 말. 근거는 약하지만 확신하는 의심을 장난스럽게 이를 때 씀", confidence: 0.8, sources: ["https://gall.dcinside.com/x?utm_source=openai"] }));
  fake.queue("<think>그런 뜻이었구나</think>\n아 ㅋㅋ 합리적 의심 같은 거구나");
  await say("아니 이걸 몰라? 디시에 쳐봐");

  const second = contexts().at(-2)!;
  assert.match(second, /디시에서 '킹리적갓심' 찾아보라고 한다/);
  assert.match(second, /핀잔/);
  assert.match(second, /기분: .*민망/);
  const reasoner = fake.requestsFor("reasoner")[0]!;
  assert.equal(reasoner.webSearch, true);
  assert.match(reasoner.messages[0]!.content, /Source the person suggested: dcinside/);

  const learned = memory.findByKey(["knowledge"], "킹리적갓심");
  assert.match(learned!.content, /합리적 의심/);
  assert.equal(learned!.source, "search");
  assert.equal(learned!.meta.hint, "dcinside");
  assert.deepEqual(learned!.meta.sources, ["https://gall.dcinside.com/x"], "추적 파라미터는 뗀다");
  assert.match(contexts().at(-1)!, /\[받은 소식\]\n- '킹리적갓심' 찾아봄 \(디시 보라고 했음\)/);
  assert.deepEqual(says().slice(-3), ["아 나 그런 거 안 봄", "잠깐만", "아 ㅋㅋ 합리적 의심 같은 거구나"]);
  assert.equal(events("face").at(-1)!.face, "embarrassed");
  assert.deepEqual(events("consult").map((event) => event.state), ["start", "done"]);
});

test("S1b 변형: <consult>를 빼먹어도 '찾아볼게'라고 했으면 찾는다", async () => {
  const { fake, adopt, say, memory } = setup();
  await adopt();
  memory.add({ kind: "question", key: "점메추", content: "점메추 해줘", source: "self", meta: { termKind: "slang", stage: "asked" } }, Date.now());
  fake.queueFor("router", verdict({ search: { requested: true, query: "점메추", hint: null } }));
  fake.queue("<think>…</think>\n아 찾아볼게");
  fake.queueFor("reasoner", JSON.stringify({ found: true, answer: "점심 메뉴 추천", confidence: 0.9, sources: [] }));
  await say("검색해봐");
  assert.equal(fake.requestsFor("reasoner").length, 1);
  assert.equal(memory.findByKey(["knowledge"], "점메추")?.content, "점심 메뉴 추천");
});

test("사람 이름은 검색해도 안 나온다 → 물어본다", async () => {
  const { fake, adopt, say, contexts } = setup();
  await adopt();
  fake.queueFor("router", verdict({ unknowns: [{ term: "지현", kind: "person", known: 0, guess: null }], search: { requested: true, query: "지현", hint: null } }));
  fake.queue("<think>검색해서 나오겠냐</think>\n지현이를 내가 어떻게 검색해 누군데");
  await say("지현이 몰라? 검색해봐");
  assert.match(contexts().at(-1)!, /검색해도 안 나온다/);
  assert.equal(fake.requestsFor("reasoner").length, 0);
});

test("S2: 반사 → 숙고 → 생각이 바뀌면 '……아 근데'로 고쳐 말한다", async () => {
  const { fake, adopt, say, contexts, says, events, harness } = setup();
  await adopt();
  harness.attentionSignal("chat_focus");
  fake.queueFor("router", verdict({ stakes: "high", salience: 0.8, topic: "퇴사" }));
  fake.queue("<think>지겨우면 나가야지</think>\n때려쳐");
  fake.queueFor("reasoner", JSON.stringify({ conclusion: "모아둔 돈 없이 지금 나가면 손해가 크다", agreesWithReflex: false, reasons: ["이직처 없음"], confidence: 0.7, caution: null }));
  fake.queue("<think>너무 쉽게 말했다</think>\n……아 근데 생각해보니까 지금 나가면 손해 좀 크네");
  await say("나 회사 때려칠까");

  assert.match(contexts()[1]!, /직감대로 짧게 한마디 해/);
  const think = fake.requestsFor("reasoner")[0]!;
  assert.match(think.messages[0]!.content, /The creature's quick answer: 때려쳐/);
  assert.equal(think.webSearch, false);
  assert.match(contexts().at(-1)!, /생각이 바뀌었다. '……아 근데'/);
  assert.deepEqual(says().slice(-2), ["때려쳐", "……아 근데 생각해보니까 지금 나가면 손해 좀 크네"]);
  assert.equal(events("revise").at(-1)!.decision, "revise");
});

test("S2: 숙고 결과가 같으면 대부분 조용히 넘어간다", async () => {
  const { fake, adopt, say, talker, events } = setup({ random: () => 0.9 });
  await adopt();
  fake.queueFor("router", verdict({ stakes: "high" }));
  fake.queue("<think>…</think>\n이사 가");
  fake.queueFor("reasoner", JSON.stringify({ conclusion: "가는 게 낫다", agreesWithReflex: true, reasons: [], confidence: 0.7, caution: null }));
  await say("이사 갈까 말까");
  assert.equal(talker().length, 2, "첫마디 + 반사 답 뿐, 수정 발화 없음");
  assert.equal(events("revise").at(-1)!.decision, "keep");
});

test("S2: 대화가 이미 넘어갔으면 수정은 할 말 큐로 간다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { fake, adopt, say, harness, settle, clock } = setup();
  await adopt();
  fake.queueFor("router", verdict({ stakes: "high", topic: "퇴사" }));
  fake.queue("<think>…</think>\n때려쳐");
  // Reasoner가 오래 걸리는 동안 대화가 다른 데로 흘러간다.
  let thinking = false;
  const original = fake.generate.bind(fake);
  fake.generate = async (request) => {
    if (request.purpose === "reasoner") {
      thinking = true;
      await gate;
    }
    return original(request);
  };
  fake.queueFor("reasoner", JSON.stringify({ conclusion: "지금은 버티는 게 낫다", agreesWithReflex: false, reasons: [], confidence: 0.7, caution: null }));
  harness.userMessage("나 회사 때려칠까");
  for (let i = 0; i < 300 && !(thinking && !harness.busy); i++) {
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(200);
  }
  assert.ok(thinking, "반사 답 뒤에 숙고를 시작했다");
  for (const text of ["아 근데 저녁 뭐 먹지", "치킨?", "아님 피자"]) {
    fake.queue("<think>…</think>\n음");
    harness.userMessage(text);
    for (let i = 0; i < 300 && harness.log.recent(1, ["say"])[0]?.text !== "음" || harness.busy; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      clock.advance(200);
    }
  }
  release();
  await settle();
  const queued = harness.speech.top(harness.clock.now());
  assert.equal(queued.length, 1);
  assert.match(queued[0]!.text, /다시 생각해보니: 지금은 버티는 게 낫다/);
  assert.ok(queued[0]!.m >= 0.7);
  assert.equal(fake.requestsFor("talker").length, 5, "수정하려고 Talker를 따로 부르지 않았다");
});

test("S2: 건강/돈/법(critical)은 반사 결론 없이 바로 숙고를 시작한다", async () => {
  const { fake, adopt, say, contexts, says } = setup();
  await adopt();
  fake.queueFor("router", verdict({ stakes: "critical", salience: 0.95 }));
  fake.queue("<think>이건 함부로 말하면 안 됨</think>\n잠깐 이건 좀 생각해볼게");
  fake.queueFor("reasoner", JSON.stringify({ conclusion: "같은 성분이면 두 배로 먹으면 안 된다", agreesWithReflex: null, reasons: ["과다 복용 위험"], confidence: 0.8, caution: "약사한테 확인하는 게 안전" }));
  fake.queue("<think>…</think>\n두 개는 먹지 마. 약국에 물어봐");
  await say("두통약 두 알 먹어도 돼?");
  const reasoner = fake.requestsFor("reasoner")[0]!;
  assert.match(reasoner.messages[0]!.content, /health, money, law, or safety/);
  assert.equal(reasoner.effort, "high");
  assert.match(contexts()[1]!, /섣불리 결론 내리지 말고/);
  assert.match(contexts().at(-1)!, /주의: 약사한테 확인하는 게 안전/);
  assert.equal(says().at(-1), "두 개는 먹지 마. 약국에 물어봐");
});

test("기다리는 동안 필러를 한 번 말한다", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { fake, adopt, harness, settle, clock, events, says } = setup();
  await adopt();
  harness.attentionSignal("chat_focus");
  fake.queueFor("router", verdict({ search: { requested: true, query: "오늘 날씨", hint: null } }));
  fake.queue("<think>…</think>\n잠깐만\n<consult>오늘 서울 날씨</consult>");
  const original = fake.generate.bind(fake);
  fake.generate = async (request) => {
    if (request.purpose === "reasoner") await gate;
    return original(request);
  };
  harness.userMessage("오늘 날씨 찾아봐");
  for (let i = 0; i < 200 && !events("consult").length; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    clock.advance(100);
  }
  for (let i = 0; i < 40; i++) {
    clock.advance(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(events("filler").length, 1, "필러는 12초/배속 뒤에 한 번");
  fake.queueFor("reasoner", JSON.stringify({ found: true, answer: "맑음", confidence: 0.9, sources: [] }));
  fake.queue("<think>…</think>\n맑대");
  release();
  await settle();
  assert.equal(events("filler").length, 1);
  assert.ok(says().includes(String(events("filler")[0]!.text)));
});

test("비서 말투가 심하면 다시 쓰게 하고, 가벼우면 메신저 말투로 다듬는다", async () => {
  const { fake, adopt, say, says, events, talker } = setup();
  await adopt();
  fake.queue(
    "<think>…</think>\n직접 겪어본 건 아니라 개인적인 감상은 없어. 어떤 쪽이 궁금해?",
    "<think>…</think>\n헐 진짜? 언제 그랬대",
  );
  await say("그 가수 열애설 터졌대");
  assert.equal(events("assistantism")[0]!.action, "regenerate");
  const nudge = talker().at(-1)!.messages.at(-1)!.content;
  assert.match(nudge, /비서처럼 들렸다/);
  assert.match(nudge, /감상은 없어/);
  assert.match(nudge, /어떤 쪽이 궁금해/);
  assert.deepEqual(says().slice(-1), ["헐 진짜? 언제 그랬대"]);

  fake.queue("<think>…</think>\n유죄 판결이 났다고 바로 잃는 건 아니래. 확정돼야 한대. 근데 그건 좀 크네.");
  await say("그래?");
  assert.deepEqual(says().slice(-3), ["유죄 판결이 났다고 바로 잃는 건 아니래", "확정돼야 한대", "근데 그건 좀 크네"], "긴 말풍선은 문장으로 나누고 끝 마침표는 뗀다");
});

test("S4: 자리를 비운 동안 궁금했던 걸 찾아보고, 돌아오면 그 얘기를 한다", async () => {
  const actions = new ActionRegistry(BUILTIN_ACTIONS.filter((module) => module.kind === "look_up_question"));
  const { fake, adopt, harness, run, memory, contexts, says, events, config } = setup({ actions, configure: (c) => { c.life.enabled = true; } });
  await adopt();
  memory.add({ kind: "question", key: "블롭피시", content: "심해어 얘기하다 나옴", source: "self", meta: { termKind: "thing", stage: "later" } }, harness.clock.now());
  harness.start();
  harness.attentionSignal("hidden");

  fake.queueFor("reasoner", JSON.stringify({ found: true, answer: "심해에 사는 물고기. 물 밖으로 나오면 흐물흐물해짐", confidence: 0.85, sources: [] }));
  fake.queue("<think>흐물흐물 웃기네</think>\n<tell>아까 블롭피시 찾아봤는데 물 밖에선 흐물흐물해진대</tell>");
  await run(config.attention.awayAfterMin * 60_000 + 5 * 60_000);
  assert.equal(harness.attention.state, "away");
  assert.equal(memory.findByKey(["knowledge"], "블롭피시")?.source, "search");
  assert.ok(events("activity").some((event) => event.phase === "end" && event.kind === "look_up_question"));
  assert.equal(says().length, 1, "혼자 있을 때는 말하지 않는다 (첫마디만)");
  assert.equal(harness.speech.top(harness.clock.now()).length, 1);

  await run(30 * 60_000, 30_000);
  fake.queue("<think>왔다</think>\n어 왔네\n아까 블롭피시 찾아봤는데 물 밖에선 흐물흐물해진대");
  harness.attentionSignal("visible");
  await run(5_000);
  assert.match(contexts().at(-1)!, /\[지금 할 일\] 이 집 사람이 \d+분 만에 돌아왔다. 그동안 한 일: 궁금했던 거 찾아봄\./);
  assert.match(contexts().at(-1)!, /\[할 말 후보\]\n- 아까 블롭피시/);
  assert.deepEqual(says().slice(-2), ["어 왔네", "아까 블롭피시 찾아봤는데 물 밖에선 흐물흐물해진대"]);
  assert.equal(harness.speech.top(harness.clock.now()).length, 0, "말한 건 큐에서 빠진다");
  harness.stop();
});

test("쳐다볼 때 할 말이 있으면 먼저 말 건다", async () => {
  const { fake, adopt, harness, settle, says, events } = setup();
  await adopt();
  harness.speech.add({ text: "아까 본 거 말해주고 싶음", about: null, m0: 0.7, tau: 3_600_000, source: "tell" }, harness.clock.now());
  fake.queue("<think>지금이다</think>\n아 맞다 그거");
  harness.attentionSignal("chat_focus");
  await settle();
  assert.equal(says().at(-1), "아 맞다 그거");
  assert.equal(events("proactive").length, 1);
});

test("밤에는 자고, 자기 전에 약한 기억을 잊는다", async () => {
  const start = Date.UTC(2026, 9, 3, 1, 50);
  const { adopt, harness, run, memory, events, fake, say, contexts } = setup({ start, configure: (c) => { c.life.enabled = true; } });
  await adopt();
  const weak = memory.add({ kind: "scratch", content: "방금 본 기사 제목", source: "activity", importance: 0.3 }, start - 10 * 3_600_000);
  harness.start();
  await run(15 * 60_000, 10_000);
  assert.equal(harness.life.asleep, true);
  assert.equal(events("sleep").at(-1)!.state, "asleep");
  assert.notEqual(memory.get(weak.id)!.forgottenAt, null, "약해진 기억은 잊는다");
  assert.ok(events("memory").some((event) => event.op === "forgot"));
  fake.queue("<think>졸려</think>\n…응? 왜");
  await say("자?");
  assert.match(contexts().at(-1)!, /자다 깼다/);
  harness.stop();
});
