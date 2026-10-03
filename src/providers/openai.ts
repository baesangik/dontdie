// OpenAI API 키 Provider (Responses API). OPENAI_API_KEY 환경 변수를 쓴다.

import { ProviderError, type GenerateRequest, type GenerateResult, type ModelInfo, type Provider, type ProviderStatus } from "./types.js";

const BASE = "https://api.openai.com/v1";

export class OpenAIProvider implements Provider {
  readonly id = "openai" as const;
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY) {}

  async status(): Promise<ProviderStatus> {
    return this.apiKey ? { ready: true, detail: "OPENAI_API_KEY 사용" } : { ready: false, detail: "OPENAI_API_KEY 환경 변수가 없다." };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const body = await this.#request("GET", "/models", undefined, signal) as { data?: { id: string }[] };
    return (body.data ?? []).map((model) => model.id).filter((id) => /^(gpt|o\d)/.test(id)).sort().map((id) => ({ id, label: id }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = await this.#request("POST", "/responses", {
      model: request.model,
      instructions: request.instructions,
      input: request.messages.map((message) => ({ role: message.role, content: message.content })),
      store: false,
      ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
    }, request.signal) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = (body.output ?? [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text ?? "")
      .join("");
    request.onDelta?.(text);
    return { text };
  }

  async #request(method: string, path: string, payload?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.apiKey) throw new ProviderError("no_api_key", "OPENAI_API_KEY 환경 변수가 없다.");
    const response = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      ...(signal ? { signal } : {}),
    });
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new ProviderError(body.error?.code ?? `http_${response.status}`, body.error?.message ?? `OpenAI API 오류 (${response.status})`, response.status === 429 || response.status >= 500, response.status);
    }
    return body;
  }
}
