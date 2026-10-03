import type { ProviderId } from "../config.js";

export interface ChatMessage {
  /** developer = 하네스가 넣는 상황 설명 ("[상황] 방금 집 안으로 데려왔다") */
  role: "user" | "assistant" | "developer";
  content: string;
}

export interface GenerateRequest {
  model: string;
  instructions: string;
  messages: ChatMessage[];
  effort?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface GenerateResult {
  text: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProviderStatus {
  ready: boolean;
  /** 사람이 읽을 상태 설명 */
  detail?: string;
  /** ChatGPT 로그인이 필요함 */
  needsLogin?: boolean;
  account?: string;
}

export interface Provider {
  readonly id: ProviderId;
  status(): Promise<ProviderStatus>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** 모든 Provider 오류는 이 형태로 바꿔서 던진다. UI 시스템 배지에 그대로 표시된다. */
export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, status: this.status };
  }
}

export function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") return new ProviderError("cancelled", "요청이 취소됐다.");
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError("unknown", message, true);
}
