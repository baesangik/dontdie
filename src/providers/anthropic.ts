// Anthropic (Claude) Provider. API 키만 지원한다.
// Claude 구독(Free/Pro/Max) 로그인은 서드파티 앱에서 허용되지 않는다.

import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatMessage, type Citation, type GenerateRequest, type GenerateResult, type ModelInfo, type Provider, type ProviderStatus } from "./types.js";

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
    const haiku = request.model.startsWith("claude-haiku");
    // Haiku 4.5는 effort를 받지 않는다. none은 가장 낮은 low로 바꾼다.
    const effort = haiku ? undefined : request.effort === "none" ? "low" : request.effort;
    const outputConfig: Anthropic.OutputConfig = {
      ...(effort && EFFORTS.has(effort) ? { effort: effort as Anthropic.OutputConfig["effort"] } : {}),
      ...(request.json ? { format: { type: "json_schema" as const, schema: request.json.schema } } : {}),
    };
    const messages = toMessages(request.messages);
    const params = {
      model: request.model,
      max_tokens: request.maxOutputTokens ?? 16000,
      system: request.instructions,
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      // 동적 필터링 웹 검색은 최신 모델만 된다. Haiku 4.5는 기본 버전을 쓴다.
      ...(request.webSearch ? { tools: [haiku ? { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 3 } : { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 3 }] } : {}),
    };
    try {
      const options = request.signal ? { signal: request.signal } : {};
      let text = "";
      const citations = new Map<string, Citation>();
      // 서버 도구(웹 검색)가 길어지면 pause_turn으로 멈춘다. 이어서 부른다.
      for (let round = 0; round < 4; round++) {
        // Opus 5 계열은 정책상 거절될 때 서버가 다른 모델로 이어서 답하도록 fallback을 켠다.
        const response: { content: AnyBlock[]; stop_reason: string | null } = request.model.startsWith("claude-opus-5") || request.model.startsWith("claude-fable-5-1")
          ? await client.beta.messages.create({ ...params, messages, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Anthropic.Beta.MessageCreateParamsNonStreaming, options) as never
          : await client.messages.create({ ...params, messages } as Anthropic.MessageCreateParamsNonStreaming, options) as never;
        if (response.stop_reason === "refusal") throw new ProviderError("refusal", "모델이 응답을 거절했다.");
        for (const block of response.content) {
          if (block.type !== "text") continue;
          text += block.text ?? "";
          for (const citation of block.citations ?? []) {
            if (citation.type === "web_search_result_location" && citation.url && !citations.has(citation.url)) {
              citations.set(citation.url, { url: citation.url, ...(citation.title ? { title: citation.title } : {}) });
            }
          }
        }
        if (response.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
      }
      request.onDelta?.(text);
      return { text, ...(citations.size ? { citations: [...citations.values()] } : {}) };
    } catch (error) {
      throw convert(error);
    }
  }
}

interface AnyBlock {
  type: string;
  text?: string;
  citations?: { type: string; url?: string; title?: string | null }[] | null;
}

/** developer 메시지는 상황 설명으로 user 턴에 넣는다. 첫 메시지는 user여야 하고, 같은 역할이 이어지면 합친다. */
function toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = message.role === "developer" ? `[상황] ${message.content}` : message.content;
    const last = result[result.length - 1];
    if (last?.role === role) last.content += `\n\n${content}`;
    else result.push({ role, content });
  }
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
