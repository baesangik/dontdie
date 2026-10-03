// OpenAI 호환 로컬 서버 Provider (Ollama, llama.cpp, vLLM 등). 파인튜닝한 Talker를 쓸 때 필요하다.

import { ProviderError, type GenerateRequest, type GenerateResult, type ModelInfo, type Provider, type ProviderStatus } from "./types.js";

export class LocalProvider implements Provider {
  readonly id = "local" as const;
  constructor(private readonly baseUrl: string) {}

  async status(): Promise<ProviderStatus> {
    try {
      await this.listModels(AbortSignal.timeout(2000));
      return { ready: true, detail: this.baseUrl };
    } catch {
      return { ready: false, detail: `${this.baseUrl}에 연결할 수 없다.` };
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const body = await this.#request("GET", "/models", undefined, signal) as { data?: { id: string }[] };
    return (body.data ?? []).map((model) => ({ id: model.id, label: model.id }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = await this.#request("POST", "/chat/completions", {
      model: request.model,
      messages: [
        { role: "system", content: request.instructions },
        ...request.messages.map((message) => ({ role: message.role === "developer" ? "system" : message.role, content: message.content })),
      ],
      ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
      // 대부분의 OpenAI 호환 서버(Ollama, llama.cpp, vLLM)가 json_schema 형식을 받는다.
      ...(request.json ? { response_format: { type: "json_schema", json_schema: { name: request.json.name, strict: true, schema: request.json.schema } } } : {}),
    }, request.signal) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    request.onDelta?.(text);
    // 로컬 서버에는 웹 검색이 없다.
    return { text, ...(request.webSearch ? { webSearchUnavailable: true } : {}) };
  }

  async #request(method: string, path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
        method,
        headers: payload ? { "content-type": "application/json" } : {},
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new ProviderError("local_unreachable", `로컬 모델 서버(${this.baseUrl})에 연결할 수 없다.`, true);
    }
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
    if (!response.ok) {
      const message = typeof body.error === "string" ? body.error : body.error?.message;
      throw new ProviderError(`http_${response.status}`, message ?? `로컬 모델 서버 오류 (${response.status})`, response.status >= 500, response.status);
    }
    return body;
  }
}
