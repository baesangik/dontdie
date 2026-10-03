// 모르는 것 사다리 (MECHANISMS §1). 모르는 게 나오면 바로 검색하지 않고 가장 싼 방법부터 쓴다.
// 무시 → 추측 → 질문 → 검색 → 숙고. 단계는 하네스가 정하고, 말투는 Talker가 정한다.

import type { Memory } from "../memory/store.js";
import type { TermKind, Verdict } from "./verdict.js";

export type LadderStage =
  | "remembered"    // 기억에 있다 (전에 배웠다)
  | "known"         // 모델이 원래 안다. 모르는 척하지 않는다.
  | "ignore"        // 별로 안 중요해서 맥락으로 넘긴다
  | "guess"         // "그거 ~ 말하는 거지?"
  | "ask"           // "그게 뭔데?"
  | "search"        // 찾아보라고 했다 (Talker가 <consult>로 결정)
  | "unsearchable"  // 이 집 사람 주변 사람/장소라 검색해도 안 나온다 → 물어본다
  | "later";        // 지금은 물어볼 상황이 아니다 → 나중에 혼자 찾아본다

export interface LadderStep {
  term: string;
  kind: TermKind | "query";
  stage: LadderStage;
  guess?: string | null;
  memory?: Memory;
  query?: string;
  hint?: string | null;
}

export interface LadderInput {
  verdict: Verdict;
  /** 이 집 사람이 지금 대화 중인가 */
  userPresent: boolean;
  /** 검색할 체력/예산이 있는가 */
  canSearch: boolean;
  /** 기억에서 찾기 (사람, 지식) */
  recall(term: string): Memory | undefined;
  /** 물어봤거나 궁금해하던 것 (question 기억) */
  question(term: string): Memory | undefined;
  /** 열린 질문, 최근 것부터 */
  openQuestions: Memory[];
}

const PERSONAL: readonly string[] = ["person", "place"];
const KNOWN_ENOUGH = 0.75;
const GUESSABLE = 0.4;

export function climbLadder(input: LadderInput): LadderStep[] {
  const { verdict } = input;
  const steps: LadderStep[] = [];
  const searchTarget = verdict.search.requested ? targetOfSearch(input) : undefined;

  for (const unknown of verdict.unknowns) {
    const step: LadderStep = { term: unknown.term, kind: unknown.kind, stage: "ask", guess: unknown.guess };
    const memory = input.recall(unknown.term);
    const asked = input.question(unknown.term);
    const personal = PERSONAL.includes(unknown.kind);
    const wantsSearch = searchTarget !== undefined && sameTerm(searchTarget, unknown.term);

    if (memory) {
      step.stage = "remembered";
      step.memory = memory;
    } else if (unknown.known >= KNOWN_ENOUGH) {
      // 유명한 사람이나 장소도 여기서 걸린다. 진짜 모르는 것만 모른다.
      step.stage = "known";
    } else if (personal) {
      // 사람과 장소는 검색해도 안 나온다. 항상 물어본다. 이미 물어봤으면 조르지 않는다.
      step.stage = wantsSearch ? "unsearchable" : asked ? "ignore" : verdict.salience < 0.25 ? "ignore" : input.userPresent ? "ask" : "later";
    } else if (wantsSearch || (asked && verdict.pressure === "scoff")) {
      step.stage = input.canSearch ? "search" : "later";
      step.query = verdict.search.query ?? unknown.term;
      step.hint = verdict.search.hint;
    } else if (unknown.known >= GUESSABLE && unknown.guess) {
      step.stage = "guess";
    } else if (asked) {
      // 이미 한 번 물어봤는데 설명을 안 해줬다. 또 묻지 말고 나중에 찾아본다.
      step.stage = "later";
    } else if (verdict.salience < 0.25) {
      step.stage = "ignore";
    } else {
      step.stage = input.userPresent ? "ask" : "later";
    }
    steps.push(step);
  }

  // "디시에 쳐봐"처럼 이번 메시지에 모르는 말이 없는데 찾아보라고 했다 → 아까 물어본 것이나 query를 찾는다.
  if (searchTarget !== undefined && !steps.some((step) => step.stage === "search" || step.stage === "unsearchable")) {
    const open = input.question(searchTarget);
    const kind = (open?.meta.termKind as TermKind | undefined) ?? "query";
    if (PERSONAL.includes(kind)) {
      steps.push({ term: searchTarget, kind, stage: "unsearchable" });
    } else {
      steps.push({ term: searchTarget, kind, stage: input.canSearch ? "search" : "later", query: verdict.search.query ?? searchTarget, hint: verdict.search.hint });
    }
  }
  return steps;
}

/** "그거 찾아봐"가 무엇을 가리키는가: Router의 query → 가장 최근에 물어본 것. */
function targetOfSearch(input: LadderInput): string | undefined {
  const query = input.verdict.search.query;
  if (query) {
    const open = input.openQuestions.find((question) => question.key && (sameTerm(query, question.key) || query.includes(question.key)));
    return open?.key ?? query;
  }
  return input.openQuestions[0]?.key ?? input.verdict.unknowns[0]?.term;
}

function sameTerm(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
