// 테스트와 오프라인 데모용 Provider. 계층(purpose)별로 정해진 응답을 순서대로 돌려준다.
// 쌓아둔 응답이 없으면 기본 응답기를 쓴다: Router는 규칙 판정, Reasoner는 가짜 노트, Talker는 짧은 대답.

import { ruleVerdict } from "../mind/rules.js";
import type { GenerateRequest, GenerateResult, ModelInfo, Provider, ProviderStatus } from "./types.js";

export type FakeResponder = (request: GenerateRequest) => string | Promise<string>;

function lastContent(request: GenerateRequest): string {
  return request.messages[request.messages.length - 1]?.content ?? "";
}

/** 아무 설정 없이 켰을 때의 기본 응답. 실제 모델 없이 UI를 둘러볼 때 쓴다. */
export const defaultResponder: FakeResponder = (request) => {
  const content = lastContent(request);
  if (request.purpose === "router") {
    const language = /Conversation language: en/.test(content) ? "en" : "ko";
    const text = content.split("NEW message from the person:\n")[1] ?? content;
    return JSON.stringify({ ...ruleVerdict(text, language), source: undefined });
  }
  if (request.purpose === "reasoner") {
    if (/Task: look this up/.test(content)) {
      const query = /Query: (.*)/.exec(content)?.[1] ?? "?";
      return JSON.stringify({ found: true, answer: `(fake) '${query}'는 대충 이런 뜻이라고 함`, confidence: 0.6, sources: [] });
    }
    return JSON.stringify({ conclusion: "(fake) 좀 더 따져봐야 함", agreesWithReflex: true, reasons: [], confidence: 0.5, caution: null });
  }
  // Talker: 대화 끝의 "[지금]" 블록 바로 앞이 실제 마지막 메시지다.
  const messages = request.messages.filter((message) => !message.content.startsWith("[지금]") && !message.content.startsWith("[Now]"));
  const last = messages[messages.length - 1];
  if (/\[지금 할 일\] 밤이다|\[Right now\] It's night/.test(content)) return "<think>일기</think>\n(fake) 오늘은 별일 없었다.";
  if (/\[지금 할 일\] 혼자|\[Right now\] You're alone/.test(content)) return "<think>(fake) 흠</think>";
  if (/<consult>/.test(content)) {
    const query = /<consult>(.*?)<\/consult>/.exec(content)?.[1] ?? "";
    return `<think>찾아봐야지</think>\n잠깐만\n<consult>${query}</consult>`;
  }
  if (last?.role === "developer") return "<think>여기가 집인가</think>\n…실례합니다";
  const text = last?.content ?? "";
  if (/이름/.test(text)) return "<think>본명은 말 안 할 거다</think>\n이름? 까먹었는데\n그러면 니가 지어줘";
  return `<think>(fake) ${text.slice(0, 20)}</think>\n음`;
};

export class FakeProvider implements Provider {
  readonly id = "fake" as const;
  readonly requests: GenerateRequest[] = [];
  #scripts = new Map<string, (string | Error)[]>();

  /** responder는 Talker 호출에만 쓴다. Router와 Reasoner는 쌓아둔 응답이 없으면 기본 응답기를 쓴다. */
  constructor(private readonly responder: FakeResponder = defaultResponder) {}

  /** 다음 Talker 호출들이 돌려줄 응답을 쌓는다. Error를 넣으면 그 호출은 실패한다. */
  queue(...responses: (string | Error)[]) {
    return this.queueFor("talker", ...responses);
  }

  /** 특정 계층(router, talker, reasoner) 호출의 응답을 쌓는다. */
  queueFor(purpose: string, ...responses: (string | Error)[]) {
    const script = this.#scripts.get(purpose) ?? [];
    script.push(...responses);
    this.#scripts.set(purpose, script);
    return this;
  }

  /** 계층별 요청 */
  requestsFor(purpose: string) {
    return this.requests.filter((request) => (request.purpose ?? "talker") === purpose);
  }

  async status(): Promise<ProviderStatus> { return { ready: true, detail: "fake provider" }; }
  async listModels(): Promise<ModelInfo[]> { return [{ id: "fake", label: "fake" }]; }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const next = this.#scripts.get(request.purpose ?? "talker")?.shift();
    if (next instanceof Error) throw next;
    const talker = (request.purpose ?? "talker") === "talker";
    const text = next ?? await (talker ? this.responder : defaultResponder)(request);
    request.onDelta?.(text);
    return { text };
  }
}
