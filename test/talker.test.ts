import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCharacter } from "../src/character/state.js";
import { buildInstructions, formatAssistantTurn, parseTalker, renderTemplate } from "../src/layers/talker.js";

test("속생각, 말풍선, 이름 태그를 분리한다", () => {
  const output = parseTalker("<think>본명은 말 안 해</think>\n이름? 까먹었는데\n그러면 니가 지어줘");
  assert.equal(output.thought, "본명은 말 안 해");
  assert.deepEqual(output.bubbles, ["이름? 까먹었는데", "그러면 니가 지어줘"]);

  const named = parseTalker("<think>나쁘지 않네</think>\n…그건 괜찮네\n<name>콩이</name>");
  assert.equal(named.acceptName, "콩이");
  assert.deepEqual(named.bubbles, ["…그건 괜찮네"]);

  const refused = parseTalker("<think>개 이름이잖아</think>\n그건 개 이름 아님?\n<refuse_name>뽀삐</refuse_name>");
  assert.equal(refused.refuseName, "뽀삐");
  assert.equal(refused.acceptName, undefined);

  const address = parseTalker("<think>…</think>\n싫은데\n<refuse_address>주인님</refuse_address>");
  assert.equal(address.refuseAddress, "주인님");
});

test("속생각만 있으면 침묵이다", () => {
  const output = parseTalker("<think>딱히 할 말 없음</think>");
  assert.deepEqual(output.bubbles, []);
});

test("닫는 태그를 빼먹어도 첫 줄을 속생각으로 본다", () => {
  const output = parseTalker("<think>음 뭐지\n뭐야");
  assert.equal(output.thought, "음 뭐지");
  assert.deepEqual(output.bubbles, ["뭐야"]);
});

test("목록 기호를 걷어내고 말풍선은 최대 4개", () => {
  const output = parseTalker("- 하나\n* 둘\n1. 셋\n넷\n다섯");
  assert.deepEqual(output.bubbles, ["하나", "둘", "셋", "넷"]);
});

test("[key] / [!key] 줄 머리표", () => {
  const template = "<!-- 주석 -->\n[name] 이름: {{name}}\n[!name] 이름 없음\n공통";
  assert.equal(renderTemplate(template, { name: "콩이" }), "이름: 콩이\n공통");
  assert.equal(renderTemplate(template, {}), "이름 없음\n공통");
});

test("존재 규칙: 이름이 생기면 '이름 없음' 문구가 빠진다", () => {
  const character = emptyCharacter();
  character.adoptedAt = 0;
  const before = buildInstructions("ko", character);
  assert.match(before, /아직 이 집에서 쓸 이름이 없다/);
  assert.match(before, /본명/);
  character.name = { value: "콩이", at: 0 };
  character.addressAs = { value: "형", at: 0 };
  const after = buildInstructions("ko", character);
  assert.match(after, /지어준 이름: 콩이/);
  assert.match(after, /부르는 말: 형/);
  assert.doesNotMatch(after, /아직 이 집에서 쓸 이름이 없다/);
  assert.doesNotMatch(after, /\{\{|\[!?[a-z_]+\]/);
  assert.match(buildInstructions("en", character), /real name/);
});

test("이전 턴 형식은 다시 파싱하면 같은 내용이 된다", () => {
  const turn = formatAssistantTurn({ thought: "흠", bubbles: ["안녕", "뭐"] });
  assert.deepEqual(parseTalker(turn), { thought: "흠", bubbles: ["안녕", "뭐"], tells: [] });
});

test("표정, 검색, 나중에, 할 말 태그", () => {
  const output = parseTalker("<think>민망</think>\n아 나 그런 거 안 봄\n잠깐만\n<face>embarrassed</face>\n<consult>킹리적갓심 뜻</consult>");
  assert.equal(output.face, "embarrassed");
  assert.equal(output.consult, "킹리적갓심 뜻");
  assert.deepEqual(output.bubbles, ["아 나 그런 거 안 봄", "잠깐만"]);
  const alone = parseTalker("<think>심해어 웃기네</think>\n<tell>아까 심해어 봤는데 진짜 이상하게 생김</tell>\n<later>블롭피시</later>\n<face>weird</face>");
  assert.deepEqual(alone.tells, ["아까 심해어 봤는데 진짜 이상하게 생김"]);
  assert.equal(alone.later, "블롭피시");
  assert.equal(alone.face, undefined, "모르는 표정은 버린다");
  assert.deepEqual(alone.bubbles, []);
});

test("모델이 태그를 대충 써도 말풍선에 새지 않는다", () => {
  const output = parseTalker("<think>…</think>\n…여기 들어와도 되는 거지?\n<face=embarrassed>");
  assert.equal(output.face, "embarrassed");
  assert.deepEqual(output.bubbles, ["…여기 들어와도 되는 거지?"]);
  assert.deepEqual(parseTalker("<think>…</think>\n응\n<face: happy />\n<weird a=1>").bubbles, ["응"]);
});
