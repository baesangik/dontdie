// 테스트와 오프라인 데모용 Provider. 정해진 응답을 순서대로 돌려준다.

import type { GenerateRequest, GenerateResult, ModelInfo, Provider, ProviderStatus } from "./types.js";

export type FakeResponder = (request: GenerateRequest) => string | Promise<string>;

/** 아무 설정 없이 켰을 때의 기본 응답. 실제 모델 없이 UI를 둘러볼 때 쓴다. */
const defaultResponder: FakeResponder = (request) => {
  const last = request.messages[request.messages.length - 1];
  if (last?.role === "developer") return "<think>여기가 집인가</think>\n…실례합니다";
  const text = last?.content ?? "";
  if (/이름/.test(text)) return "<think>본명은 말 안 할 거다</think>\n이름? 까먹었는데\n그러면 니가 지어줘";
  return `<think>(fake provider) ${text.slice(0, 20)}</think>\n음`;
};

export class FakeProvider implements Provider {
  readonly id = "fake" as const;
  readonly requests: GenerateRequest[] = [];
  #script: (string | Error)[] = [];

  constructor(private readonly responder: FakeResponder = defaultResponder) {}

  /** 다음 호출들이 돌려줄 응답을 쌓는다. Error를 넣으면 그 호출은 실패한다. */
  queue(...responses: (string | Error)[]) {
    this.#script.push(...responses);
    return this;
  }

  async status(): Promise<ProviderStatus> { return { ready: true, detail: "fake provider" }; }
  async listModels(): Promise<ModelInfo[]> { return [{ id: "fake", label: "fake" }]; }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const next = this.#script.shift();
    if (next instanceof Error) throw next;
    const text = next ?? await this.responder(request);
    request.onDelta?.(text);
    return { text };
  }
}
