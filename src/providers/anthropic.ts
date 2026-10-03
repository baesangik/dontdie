// Anthropic (Claude) Provider. API 키만 지원한다.
// Claude 구독(Free/Pro/Max) 로그인은 서드파티 앱에서 허용되지 않는다.

import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatMessage, type GenerateRequest, type GenerateResult, type ModelInfo, type Provider, type ProviderStatus } from "./types.js";

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  #client: Anthropic | undefined;

  #get(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) throw new ProviderError("no_api_key", "ANTHROPIC_API_KEY 환경 변수가 없다.");
    this.#client ??= new Anthropic();
    return this.#client;
  }

  async status(): Promise<ProviderStatus> {
    return process.env.ANTHROPIC_API_KEY ? { ready: true, detail: "ANTHROPIC_API_KEY 사용" } : { ready: false, detail: "ANTHROPIC_API_KEY 환경 변수가 없다." };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const models: ModelInfo[] = [];
      for await (const model of this.#get().models.list({}, signal ? { signal } : {})) models.push({ id: model.id, label: model.display_name });
      return models;
    } catch (error) {
      throw convert(error);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const client = this.#get();
    // Haiku 4.5는 effort를 받지 않는다. none은 가장 낮은 low로 바꾼다.
    const effort = request.model.startsWith("claude-haiku") ? undefined : request.effort === "none" ? "low" : request.effort;
    const outputConfig = effort && EFFORTS.has(effort) ? { output_config: { effort: effort as "low" | "medium" | "high" | "xhigh" | "max" } } : {};
    const params = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 16000,
      system: request.instructions,
      messages: toMessages(request.messages),
      ...outputConfig,
    };
    try {
      const options = request.signal ? { signal: request.signal } : {};
      // Opus 5 계열은 정책상 거절될 때 서버가 다른 모델로 이어서 답하도록 fallback을 켠다.
      const response = request.model.startsWith("claude-opus-5") || request.model.startsWith("claude-fable-5-1")
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, options)
        : await client.messages.create(params, options);
      if (response.stop_reason === "refusal") throw new ProviderError("refusal", "모델이 응답을 거절했다.");
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      request.onDelta?.(text);
      return { text };
    } catch (error) {
      throw convert(error);
    }
  }
}

/** developer 메시지는 상황 설명으로 user 턴에 넣는다. 첫 메시지는 user여야 한다. */
function toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = messages.map((message) => message.role === "developer"
    ? { role: "user", content: `[상황] ${message.content}` }
    : { role: message.role, content: message.content });
  if (result[0]?.role !== "user") result.unshift({ role: "user", content: "[상황] 대화가 이어진다." });
  return result;
}

function convert(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.RateLimitError) return new ProviderError("rate_limited", "Claude 사용량 한도에 걸렸다.", true, 429);
  if (error instanceof Anthropic.AuthenticationError) return new ProviderError("invalid_api_key", "ANTHROPIC_API_KEY가 유효하지 않다.", false, 401);
  if (error instanceof Anthropic.APIError) return new ProviderError(`http_${error.status ?? "error"}`, error.message, (error.status ?? 500) >= 500, error.status);
  return new ProviderError("unknown", error instanceof Error ? error.message : String(error), true);
}
