// 규칙 기반 Router. LLM Router가 실패하거나 예산이 바닥났을 때, 그리고 테스트에서 쓴다.
// 결정적이고 공짜지만 눈치는 없다: 모르는 말이나 배운 사실은 못 잡는다.

import { ruleClosure, ruleLeaving } from "../core/attention.js";
import type { Language } from "../config.js";
import { neutralVerdict, type Stakes, type Verdict } from "./verdict.js";

interface RuleSet {
  critical: RegExp;
  high: RegExp;
  search: RegExp;
  scoff: RegExp;
  insist: RegExp;
  greeting: RegExp;
  question: RegExp;
}

const RULES: Record<Language, RuleSet> = {
  ko: {
    critical: /(약\s*(먹|복용|끊)|처방|병원|응급|아파서|숨이|죽고\s*싶|자살|자해|대출|빚|사채|소송|고소|경찰|사기\s*당|불법|위험해)/,
    high: /(때려\s*칠|그만\s*둘|퇴사|이직|헤어질|헤어져야|이혼|이사\s*갈|투자할|살까\s*말까|해야\s*할까|할까\s*말까|결정을?\s*못)/,
    search: /(검색|찾아\s*봐|찾아\s*보|쳐\s*봐|쳐봐|구글링|알아\s*봐)/,
    scoff: /(이걸\s*몰라|그것도\s*몰라|그걸\s*몰라|모른다고\?|몰라\?\?|아니\s*이걸)/,
    insist: /(그냥\s*해|빨리\s*해|하라면\s*해|시키는\s*대로)/,
    greeting: /^(안녕|하이|ㅎㅇ|좋은\s*아침|왔어|나\s*왔)/,
    question: /(\?|뭐야|뭔데|어때|왜|어떻게|언제|어디|누구)\s*$/,
  },
  en: {
    critical: /\b(medication|prescription|hospital|emergency|suicid|self[- ]harm|kill myself|loan|debt|lawsuit|sue|police|scammed|illegal)\b/i,
    high: /\b(quit my job|should i quit|break up|divorce|move out|should i (buy|invest)|can't decide)\b/i,
    search: /\b(search|google|look (it )?up)\b/i,
    scoff: /\b(you don't know|how do you not know|seriously\?)\b/i,
    insist: /\b(just do it|do it now|do as i say)\b/i,
    greeting: /^(hi|hello|hey|good morning|i'm back)\b/i,
    question: /\?\s*$/,
  },
};

const HINTS: [RegExp, string][] = [
  [/디시|dc\s*inside|dcinside|갤(러리)?에/i, "dcinside"],
  [/나무\s*위키|namu/i, "namuwiki"],
  [/위키|wiki/i, "wikipedia"],
  [/구글|google/i, "google"],
  [/네이버|naver/i, "naver"],
  [/유튜브|youtube/i, "youtube"],
  [/레딧|reddit/i, "reddit"],
];

export function ruleVerdict(text: string, language: Language): Verdict {
  const rules = RULES[language];
  const last = text.split("\n").pop() ?? text;
  const verdict = neutralVerdict();
  verdict.closure = ruleClosure(last, language);
  verdict.leaving = ruleLeaving(last, language);
  verdict.stakes = stakesOf(text, rules);
  verdict.pressure = rules.scoff.test(text) ? "scoff" : rules.insist.test(text) ? "insist" : "none";
  if (rules.search.test(text)) {
    verdict.search = { requested: true, query: null, hint: HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? null };
  }
  verdict.intent = verdict.leaving ? "farewell"
    : verdict.closure >= 0.8 ? "ack"
    : rules.greeting.test(text.trim()) ? "greeting"
    : verdict.search.requested ? "request"
    : verdict.pressure === "scoff" ? "tease"
    : rules.question.test(last.trim()) ? "question"
    : "chat";
  verdict.salience = verdict.stakes === "critical" ? 0.95 : verdict.stakes === "high" ? 0.8 : verdict.intent === "ack" ? 0.15 : 0.5;
  verdict.arousal = verdict.stakes === "low" ? 0.3 : 0.7;
  if (verdict.pressure === "scoff") {
    verdict.valence = -0.3;
    verdict.feeling = language === "ko" ? "민망" : "embarrassed";
  }
  return verdict;
}

function stakesOf(text: string, rules: RuleSet): Stakes {
  if (rules.critical.test(text)) return "critical";
  if (rules.high.test(text)) return "high";
  return "low";
}
