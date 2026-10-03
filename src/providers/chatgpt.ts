// ChatGPT 플랜 사용량으로 돌리는 기본 Provider (Sign in with ChatGPT, 오픈소스/로컬 앱용 프리뷰).

import { join } from "node:path";
import { ChatGPTError, createChatGPT, type ChatGPTClient, type SessionState } from "../../vendor/siwc-local/src/index.js";
import { keyringEncryption } from "./keyring-encryption.js";
import { ProviderError, type GenerateRequest, type GenerateResult, type ModelInfo, type Provider, type ProviderStatus } from "./types.js";

export class ChatGPTProvider implements Provider {
  readonly id = "chatgpt" as const;
  readonly client: ChatGPTClient;
  /** 플랜 경로가 reasoning effort를 거부하면 이후로는 보내지 않는다. */
  #effortUnsupported = false;
  /** 웹 검색이나 구조화 출력이 거부되면 이후로는 빼고 보낸다. */
  #searchUnsupported = false;
  #jsonUnsupported = false;

  constructor(dataDir: string) {
    this.client = createChatGPT({
      appName: "dontdie",
      appId: "dontdie",
      redirectPort: 0,
      storageDir: join(dataDir, "chatgpt"),
      credentialEncryption: keyringEncryption(),
    });
  }

  async status(): Promise<ProviderStatus> {
    return describe(await this.client.getSession());
  }

  /** 시스템 브라우저를 열어 로그인한다. 사용자가 브라우저에서 직접 동의해야 끝난다. */
  async signIn(): Promise<ProviderStatus> {
    try {
      return describe(await this.client.signIn());
    } catch (error) {
      throw convert(error);
    }
  }

  cancelSignIn() { this.client.cancelSignIn(); }

  async disconnect() {
    try { await this.client.disconnect(); } catch (error) { throw convert(error); }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const models = await this.client.listModels(signal ? { signal } : {});
      return models.map((model) => ({ id: model.slug, label: model.displayName }));
    } catch (error) {
      throw convert(error);
    }
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const options = { effort: !this.#effortUnsupported, search: Boolean(request.webSearch) && !this.#searchUnsupported, json: Boolean(request.json) && !this.#jsonUnsupported };
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.client.streamResponse({
          model: request.model,
          instructions: request.instructions,
          input: request.messages.map((message) => ({ role: message.role, content: message.content })),
          ...(options.effort && request.effort ? { reasoningEffort: request.effort } : {}),
          extraBody: {
            ...(options.search ? { tools: [{ type: "web_search" }] } : {}),
            ...(options.json && request.json ? { text: { format: { type: "json_schema", name: request.json.name, strict: true, schema: request.json.schema } } } : {}),
          },
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.onDelta ? { onDelta: request.onDelta } : {}),
        });
        return {
          text: result.text,
          ...(result.citations.length ? { citations: result.citations } : {}),
          ...(request.webSearch && !options.search ? { webSearchUnavailable: true } : {}),
        };
      } catch (error) {
        // 플랜 경로가 거부한 기능을 하나씩 끄고 다시 시도한다.
        if (attempt < 3 && error instanceof ChatGPTError && error.status === 400) {
          if (options.effort && request.effort && rejects(error, "reasoning")) { this.#effortUnsupported = true; options.effort = false; continue; }
          if (options.search && rejects(error, "tools")) { this.#searchUnsupported = true; options.search = false; continue; }
          if (options.json && rejects(error, "text")) { this.#jsonUnsupported = true; options.json = false; continue; }
          // 무엇을 거부했는지 알 수 없으면 덜 중요한 것부터 끈다.
          if (!error.param && error.code === "subscription_sharing_unsupported_capability") {
            if (options.search) { this.#searchUnsupported = true; options.search = false; continue; }
            if (options.json) { this.#jsonUnsupported = true; options.json = false; continue; }
            if (options.effort && request.effort) { this.#effortUnsupported = true; options.effort = false; continue; }
          }
        }
        throw convert(error);
      }
    }
  }
}

function rejects(error: ChatGPTError, param: string) {
  if (error.param) return error.param.startsWith(param);
  return error.code === "subscription_sharing_unsupported_capability" && error.message.toLowerCase().includes(param === "text" ? "format" : param);
}

function describe(session: SessionState): ProviderStatus {
  const account = session.identity?.email ?? session.identity?.name ?? session.profileLabel;
  if (session.status === "connected" && session.sharing) return { ready: true, detail: "ChatGPT에 연결됨", ...(account ? { account } : {}) };
  if (session.status === "connected") return { ready: false, needsLogin: true, detail: "로그인은 됐지만 ChatGPT 플랜 사용량 공유가 꺼져 있다. 다시 로그인하면서 공유를 허용해야 한다.", ...(account ? { account } : {}) };
  if (session.status === "connecting") return { ready: false, detail: "브라우저에서 로그인을 기다리는 중" };
  if (session.status === "reauth_required") return { ready: false, needsLogin: true, detail: session.error?.message ?? "다시 로그인해야 한다." };
  return { ready: false, needsLogin: true, detail: session.error?.message ?? "ChatGPT 로그인이 필요하다." };
}

function convert(error: unknown): ProviderError {
  if (error instanceof ChatGPTError) return new ProviderError(error.code, error.message, error.retryable, error.status);
  if (error instanceof ProviderError) return error;
  return new ProviderError("unknown", error instanceof Error ? error.message : String(error), true);
}
