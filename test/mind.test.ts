process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultConfig } from "../src/config.js";
import { inQuietHours } from "../src/config.js";
import { MemoryStore } from "../src/memory/store.js";
import { detectAssistantism, humanize, REGENERATE_AT } from "../src/mind/assistantism.js";
import { circadian, logicalDay } from "../src/mind/budget.js";
import { climbLadder, type LadderInput } from "../src/mind/ladder.js";
import { Mood } from "../src/mind/mood.js";
import { stripCitations } from "../src/mind/reasoner.js";
import { runRouter } from "../src/mind/router.js";
import { ruleVerdict } from "../src/mind/rules.js";
import { SpeechQueue, motivation } from "../src/mind/speech.js";
import { neutralVerdict, sanitizeVerdict, type Verdict } from "../src/mind/verdict.js";
import { FakeProvider } from "../src/providers/fake.js";

// ── 비서 말투 ──

test("첫 실제 대화에서 나온 비서 말투를 잡는다", () => {
  // 첫 실사용(gpt-6-luna Talker)에서 나온 말투를 주제만 바꿔 옮겼다
  const disclaimer = detectAssistantism(["알아. 그 가수 말하는 거지? 다만 직접 겪어본 건 아니라 개인적인 감상은 없어. 어느 면이 궁금해?"], "ko");
  assert.ok(disclaimer.score >= REGENERATE_AT, `score ${disclaimer.score}`);
  assert.ok(disclaimer.hits.includes("감상은 없어"));
  assert.ok(disclaimer.hits.includes("어떤 쪽이 궁금해"));
  const lecture = detectAssistantism(["열애설이 났다고 바로 사실인 건 아니고, 누가 보도했는지와 소속사 입장, 사진이 진짜인지에 따라 달라져. 사실이라면 공식 발표를 봐야 할 것 같아. 어느 쪽이든 사생활은 존중받는 게 맞다고 생각해."], "ko");
  assert.ok(lecture.score >= REGENERATE_AT, `score ${lecture.score}`);
  assert.equal(detectAssistantism(["헐 진짜? 언제 그랬대"], "ko").score, 0);
  assert.equal(detectAssistantism(["까먹었는데. 그냥 네가 지어줘."], "ko").score, 0);
  assert.ok(detectAssistantism(["Great question! Let me know if you need anything else."], "en").score >= REGENERATE_AT);
});

test("메신저 말투로 다듬기: 문장 나누기, 끝 마침표 떼기, 서비스 멘트 빼기", () => {
  assert.deepEqual(humanize(["응. 콩이라고 부르면 돼. 고마워."], "ko"), ["응. 콩이라고 부르면 돼. 고마워"], "짧은 건 안 나눈다");
  assert.deepEqual(humanize(["그건 좀 아닌 것 같은데. 일단 자고 내일 다시 생각해봐. 궁금한 점 있으면 말해줘."], "ko"), ["그건 좀 아닌 것 같은데", "일단 자고 내일 다시 생각해봐"]);
  assert.deepEqual(humanize(["음..."], "ko"), ["음..."], "말줄임표는 그대로");
  assert.equal(humanize(["a. b. c. d. e. f. g. h. i. j. k. l. m. n. o. p."], "en").length, 4);
});

// ── 모르는 것 사다리 ──

function ladder(partial: Partial<Verdict>, extra: Partial<LadderInput> = {}) {
  return climbLadder({
    verdict: { ...neutralVerdict(), ...partial },
    userPresent: true,
    canSearch: true,
    recall: () => undefined,
    question: () => undefined,
    openQuestions: [],
    ...extra,
  });
}

test("사다리: 아는 건 아는 척, 모르면 물어보고, 반쯤 알면 추측", () => {
  assert.equal(ladder({ unknowns: [{ term: "아이폰", kind: "thing", known: 0.95, guess: null }] })[0]!.stage, "known");
  assert.equal(ladder({ unknowns: [{ term: "킹리적갓심", kind: "slang", known: 0.1, guess: null }] })[0]!.stage, "ask");
  assert.equal(ladder({ unknowns: [{ term: "점메추", kind: "slang", known: 0.6, guess: "점심 메뉴 추천" }] })[0]!.stage, "guess");
  assert.equal(ladder({ salience: 0.1, unknowns: [{ term: "뭔가", kind: "other", known: 0.1, guess: null }] })[0]!.stage, "ignore");
  assert.equal(ladder({ unknowns: [{ term: "킹리적갓심", kind: "slang", known: 0.1, guess: null }] }, { userPresent: false })[0]!.stage, "later");
});

test("사다리: 사람은 검색 대상이 아니고, 기억에 있으면 기억난다", () => {
  const store = new MemoryStore(":memory:");
  const minsu = store.add({ kind: "person", key: "민수", content: "회사 동기", source: "user" }, 0);
  const remembered = ladder({ unknowns: [{ term: "민수", kind: "person", known: 0, guess: null }] }, { recall: (term) => (term === "민수" ? minsu : undefined) });
  assert.equal(remembered[0]!.stage, "remembered");
  assert.equal(remembered[0]!.memory?.id, minsu.id);
  const pushed = ladder({ unknowns: [{ term: "지현", kind: "person", known: 0, guess: null }], search: { requested: true, query: "지현", hint: null } });
  assert.equal(pushed[0]!.stage, "unsearchable");
  assert.equal(ladder({ unknowns: [{ term: "아이유", kind: "person", known: 0.95, guess: null }] })[0]!.stage, "known", "유명한 사람은 안다 (진짜 모르는 것만 모른다)");
});

test("사다리: '디시에 쳐봐'는 아까 물어본 걸 찾는다. 예산이 없으면 나중에", () => {
  const store = new MemoryStore(":memory:");
  const asked = store.add({ kind: "question", key: "킹리적갓심", content: "이거 완전 킹리적갓심이네", source: "self", meta: { termKind: "slang", stage: "asked" } }, 0);
  const input = { openQuestions: [asked], question: (term: string) => (term === "킹리적갓심" ? asked : undefined) };
  const steps = ladder({ pressure: "scoff", search: { requested: true, query: null, hint: "dcinside" } }, input);
  assert.deepEqual(steps.map((step) => [step.term, step.stage, step.hint]), [["킹리적갓심", "search", "dcinside"]]);
  assert.equal(ladder({ search: { requested: true, query: null, hint: null } }, { ...input, canSearch: false })[0]!.stage, "later");
  // 이미 물어봤는데 설명 없이 또 나오면 또 묻지 않는다.
  assert.equal(ladder({ unknowns: [{ term: "킹리적갓심", kind: "slang", known: 0.1, guess: null }] }, input)[0]!.stage, "later");
});

// ── Router ──

test("Router: 깨진 값은 범위를 맞추고 모르는 값은 버린다", () => {
  const verdict = sanitizeVerdict({ salience: 7, valence: -3, intent: "dance", stakes: "high", unknowns: [{ term: "", kind: "x" }, { term: "민수", kind: "person", known: 2 }], search: { requested: true, hint: "dcinside" } });
  assert.equal(verdict.salience, 1);
  assert.equal(verdict.valence, -1);
  assert.equal(verdict.intent, "other");
  assert.equal(verdict.stakes, "high");
  assert.deepEqual(verdict.unknowns, [{ term: "민수", kind: "person", known: 1, guess: null }]);
  assert.deepEqual(verdict.search, { requested: true, query: null, hint: "dcinside" });
});

test("Router: JSON이 깨지면 규칙 판정으로 넘어간다", async () => {
  const fake = new FakeProvider().queueFor("router", "음 잘 모르겠는데요");
  const result = await runRouter({ language: "ko", text: "아니 이걸 몰라? 디시에 쳐봐", recent: [], knownKeys: [], openQuestions: [] }, { provider: "fake", model: "fake" }, fake);
  assert.equal(result.fallback, "invalid_json");
  assert.equal(result.verdict.source, "rules");
  assert.equal(result.verdict.pressure, "scoff");
  assert.deepEqual(result.verdict.search, { requested: true, query: null, hint: "dcinside" });
  const request = fake.requestsFor("router")[0]!;
  assert.equal(request.json?.name, "verdict");
  assert.match(request.messages[0]!.content, /NEW message from the person:\n아니 이걸 몰라\? 디시에 쳐봐/);
});

test("규칙 판정: 대화 종료, 떠남, 무게", () => {
  assert.ok(ruleVerdict("ㅇㅋ", "ko").closure >= 0.8);
  assert.equal(ruleVerdict("나 씻고 올게", "ko").leaving, true);
  assert.equal(ruleVerdict("나 회사 때려칠까", "ko").stakes, "high");
  assert.equal(ruleVerdict("타이레놀 두 알 먹어도 돼? 약 먹고 싶은데", "ko").stakes, "critical");
  assert.equal(ruleVerdict("오늘 뭐 먹지", "ko").stakes, "low");
});

// ── 기분, 할 말 큐, 체력 ──

test("기분은 자극을 받으면 흔들리고 시간이 지나면 돌아온다", () => {
  const mood = new Mood(null, 0);
  mood.apply({ ...neutralVerdict(), valence: -0.6, arousal: 0.6, feeling: "민망", salience: 0.8 }, 0);
  assert.match(mood.describe(0, "ko")!, /민망/);
  assert.ok(mood.current(0).valence < -0.3);
  assert.equal(mood.describe(6 * 3_600_000, "ko"), null, "몇 시간 지나면 기준선");
});

test("할 말 큐: 동기는 감쇠하고, 높았던 걸 놓치면 가끔 '까먹었다'", () => {
  const queue = new SpeechQueue(null, () => 0.1);
  const item = queue.add({ text: "아까 그거 말인데", about: "퇴사", m0: 0.8, tau: 3_600_000, source: "revise" }, 0);
  assert.ok(Math.abs(motivation(item, 3_600_000) - 0.8 / Math.E) < 1e-9);
  queue.add({ text: "약한 거", about: "퇴사", m0: 0.3, tau: 3_600_000, source: "tell" }, 0);
  assert.equal(queue.items.length, 1, "같은 주제는 동기가 높은 쪽만 남는다");
  const { dropped, forgot } = queue.decay(5 * 3_600_000, "뭐 말하려고 했는데 까먹었다");
  assert.equal(dropped.length, 1);
  assert.equal(forgot?.text, "뭐 말하려고 했는데 까먹었다");
});

test("하루 리듬과 조용한 시간", () => {
  assert.equal(circadian(10), 1);
  assert.ok(circadian(4) < 0.5);
  assert.equal(inQuietHours("02:00-08:00", Date.UTC(2026, 9, 3, 3)), true);
  assert.equal(inQuietHours("23:00-07:00", Date.UTC(2026, 9, 3, 23, 30)), true, "자정을 넘는 범위");
  assert.equal(inQuietHours("23:00-07:00", Date.UTC(2026, 9, 3, 12)), false);
  assert.equal(logicalDay(Date.UTC(2026, 9, 4, 3)), "2026-10-03", "새벽 5시 전은 전날");
  assert.ok(defaultConfig().budget.daily.reasoner > 0);
});

test("검색 결과 본문에서 마크다운 인용을 걷어낸다", () => {
  assert.equal(stripCitations("장난스러운 강조 표현이다. ([hello-onl.tistory.com](https://hello-onl.tistory.com/205?utm_source=openai))"), "장난스러운 강조 표현이다.");
  assert.equal(stripCitations("[위키](https://ko.wikipedia.org/x)에 따르면 그렇다 https://a.b/c"), "위키에 따르면 그렇다");
});
