import type { ProviderId } from "../config.js";

export interface ChatMessage {
  /** developer = 하네스가 넣는 상황 설명 ("[상황] 방금 집 안으로 데려왔다") */
  role: "user" | "assistant" | "developer";
  content: string;
}

export interface JsonSchemaFormat {
  name: string;
  /** strict JSON schema: 모든 속성 required, additionalProperties: false */
  schema: Record<string, unknown>;
}

export interface GenerateRequest {
  /** 어느 계층의 호출인가. 로그와 fake provider가 쓴다. */
  purpose?: string;
  model: string;
  instructions: string;
  messages: ChatMessage[];
  effort?: string;
  maxOutputTokens?: number;
  /** 구조화 출력. 지원하지 않는 Provider는 지시문만으로 JSON을 받는다. */
  json?: JsonSchemaFormat;
  /** 모델 내장 웹 검색을 허용한다 (Reasoner). 지원하지 않으면 검색 없이 답한다. */
  webSearch?: boolean;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface Citation {
  url: string;
  title?: string;
}

export interface GenerateResult {
  text: string;
  citations?: Citation[];
  /** webSearch를 요청했지만 이 Provider/모델에서는 쓸 수 없었다 */
  webSearchUnavailable?: boolean;
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

/** 모델 출력에서 첫 JSON 객체를 꺼낸다. 코드 블록이나 앞뒤 잡담이 붙어 있어도 된다. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("invalid_json", "JSON 객체를 찾을 수 없다.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ProviderError("invalid_json", "JSON을 해석할 수 없다.");
  }
}
