// 하네스: 이벤트를 받아 Talker를 부르고, 사람 속도로 말하게 하고, 주의 상태를 굴린다.
// 판정과 타이밍은 하네스가 하고, 말은 Talker가 한다.

import { Attention, expectsReply, ruleClosure, ruleLeaving, type AttentionSignal } from "./core/attention.js";
import type { Clock } from "./core/clock.js";
import type { EventLog, LogEvent } from "./core/eventlog.js";
import { bubbleGapMs, readDelayMs, typingDelayMs } from "./core/pacing.js";
import type { Config, Language } from "./config.js";
import type { CharacterState } from "./character/state.js";
import { formatAssistantTurn, runTalker, type TalkerOutput } from "./layers/talker.js";
import type { Providers } from "./providers/index.js";
import { asProviderError, type ChatMessage, type ProviderError } from "./providers/types.js";

export const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_TYPES = ["user_message", "situation", "talker_output"] as const;
/** 로그인/키 문제. 이때는 메시지를 처리한 걸로 치지 않고, 로그인 뒤에 이어서 답한다. */
const AUTH_CODES = new Set(["sign_in_required", "sharing_not_enabled", "reauth_required", "no_api_key", "invalid_api_key"]);

const SITUATION = {
  adopt: {
    ko: "방금 이 집 사람이 현관 앞에 쭈그려 앉아 있던 너를 집 안으로 데려왔다. 처음 들어온 방이다.",
    en: "The person who lives here just brought you inside from where you were crouching at the front door. It's the first time you've been in this room.",
  },
} satisfies Record<string, Record<Language, string>>;

export interface HarnessDeps {
  clock: Clock;
  log: EventLog;
  providers: Providers;
  config: Config;
  character: CharacterState;
  saveCharacter?: (state: CharacterState) => void;
  saveConfig?: (config: Config) => void;
}

export class Harness {
  readonly clock: Clock;
  readonly log: EventLog;
  readonly providers: Providers;
  readonly attention: Attention;
  config: Config;
  character: CharacterState;
  #busy = false;
  #again = false;
  #stalled = false;
  /** Talker에게 이미 넘긴 마지막 user_message / situation 이벤트 id */
  #consumed = 0;
  #saveCharacter: (state: CharacterState) => void;
  #saveConfig: (config: Config) => void;

  constructor(deps: HarnessDeps) {
    this.clock = deps.clock;
    this.log = deps.log;
    this.providers = deps.providers;
    this.config = deps.config;
    this.character = deps.character;
    this.#saveCharacter = deps.saveCharacter ?? (() => {});
    this.#saveConfig = deps.saveConfig ?? (() => {});
    this.attention = new Attention(this.clock, this.config.attention, (change) => this.log.append("attention", { ...change }));
    // 재시작했을 때 예전 메시지에 다시 답하지 않는다.
    const last = this.log.recent(1, ["user_message", "situation"])[0];
    this.#consumed = last?.id ?? 0;
  }

  get busy() { return this.#busy; }
  get adopted() { return Boolean(this.character.adoptedAt); }

  /** 현관 앞에 앉아 있던 걸 데려온다. 이미 데려왔으면 아무것도 안 한다. */
  adopt(): boolean {
    if (this.adopted) return false;
    this.character.adoptedAt = this.clock.now();
    this.#saveCharacter(this.character);
    this.log.append("adopt", {});
    this.log.append("situation", { text: SITUATION.adopt[this.config.language] });
    this.#kick();
    return true;
  }

  userMessage(text: string) {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed) return;
    if (!this.adopted) throw new Error("not_adopted");
    this.log.append("user_message", { text: trimmed });
    this.attention.signal("sent");
    this.#kick();
  }

  attentionSignal(signal: AttentionSignal) {
    this.attention.signal(signal);
  }

  setConfig(next: Config) {
    this.config = next;
    this.#saveConfig(next);
    this.log.append("config_change", { language: next.language, layers: next.layers, pace: next.pace });
  }

  /** Talker에 넣을 대화 기록. 답은 자기가 답한 메시지 바로 뒤에 놓는다. */
  history(limit = 40): ChatMessage[] {
    const events = this.log.recent(600, HISTORY_TYPES);
    const keyed = events.map((event) => ({ key: event.type === "talker_output" ? Number(event.replyTo ?? event.id) + 0.5 : event.id, event }));
    keyed.sort((a, b) => a.key - b.key);
    return keyed.slice(-limit).map(({ event }) => toMessage(event));
  }

  /** 로그인 등으로 막혀 있던 답을 다시 시도한다. */
  resume() {
    this.#kick();
  }

  async whenIdle() {
    while (this.#busy) await new Promise((resolve) => setImmediate(resolve));
  }

  #kick() {
    this.#stalled = false;
    if (this.#busy) {
      this.#again = true;
      return;
    }
    void this.#loop();
  }

  async #loop() {
    this.#busy = true;
    try {
      do {
        this.#again = false;
        await this.#respondOnce();
      } while (!this.#stalled && (this.#again || this.#unanswered().length > 0));
    } catch (error) {
      this.log.append("error", { layer: "harness", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.#busy = false;
    }
  }

  #unanswered(): LogEvent[] {
    return this.log.recent(50, ["user_message", "situation"]).filter((event) => event.id > this.#consumed);
  }

  async #respondOnce() {
    const fresh = this.#unanswered();
    if (fresh.length === 0) return;
    const pace = this.config.pace;
    const userText = fresh.filter((event) => event.type === "user_message").map((event) => String(event.text)).join("\n");

    if (userText) {
      await this.clock.sleep(readDelayMs(userText, pace));
      this.log.append("seen", { upTo: fresh[fresh.length - 1]!.id });
    }

    // 읽는 동안 메시지가 더 왔을 수 있다. 지금까지 온 것까지 넘긴다.
    const batch = this.#unanswered();
    const replyTo = batch[batch.length - 1]!.id;
    const previous = this.#consumed;
    this.#consumed = replyTo;
    const messages = this.history();
    const layer = this.config.layers.talker;
    const language = this.config.language;

    this.log.append("thinking", { on: true });
    const started = Date.now();
    let output: TalkerOutput;
    try {
      ({ output } = await runTalker({
        layer,
        provider: this.providers.get(layer.provider),
        language,
        character: this.character,
        now: this.clock.now(),
        messages,
      }));
      this.log.append("llm_call", { layer: "talker", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: true });
    } catch (error) {
      const failure = asProviderError(error);
      this.log.append("llm_call", { layer: "talker", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: false, code: failure.code });
      this.log.append("error", { layer: "talker", ...failure.toJSON() });
      this.log.append("thinking", { on: false });
      if (AUTH_CODES.has(failure.code)) {
        this.#consumed = previous;
        this.#stalled = true;
        return;
      }
      const line = failureLine(failure, language);
      if (line) await this.#speak([line]);
      this.attention.botReplied({ closure: 0.5, expectsReply: false });
      return;
    }
    this.log.append("thinking", { on: false });

    this.#applyIdentity(output);
    this.log.append("talker_output", { replyTo, thought: output.thought ?? null, bubbles: output.bubbles });
    if (output.thought) this.log.append("thought", { text: output.thought });
    await this.#speak(output.bubbles);

    const closure = userText ? ruleClosure(userText.split("\n").pop()!, language) : 0;
    this.attention.botReplied({ closure, expectsReply: expectsReply(output.bubbles) });
    if (userText && ruleLeaving(userText.split("\n").pop()!, language)) this.attention.leaving();
  }

  async #speak(bubbles: string[]) {
    const pace = this.config.pace;
    for (const [index, text] of bubbles.entries()) {
      this.log.append("typing", { on: true });
      await this.clock.sleep(typingDelayMs(text, pace));
      this.log.append("say", { text });
      if (index < bubbles.length - 1) await this.clock.sleep(bubbleGapMs(pace));
    }
    if (bubbles.length) this.log.append("typing", { on: false });
  }

  #applyIdentity(output: TalkerOutput) {
    const at = this.clock.now();
    let changed = false;
    if (output.acceptName && output.acceptName !== this.character.name?.value) {
      if (this.character.name) this.character.previousNames.push(this.character.name);
      this.character.name = { value: output.acceptName, at };
      this.log.append("name_given", { name: output.acceptName });
      changed = true;
    }
    if (output.refuseName) {
      this.character.rejectedNames.push({ value: output.refuseName, at });
      this.log.append("name_refused", { name: output.refuseName });
      changed = true;
    }
    if (output.acceptAddress && output.acceptAddress !== this.character.addressAs?.value) {
      if (this.character.addressAs) this.character.addressHistory.push(this.character.addressAs);
      this.character.addressAs = { value: output.acceptAddress, at };
      this.log.append("address_set", { address: output.acceptAddress });
      changed = true;
    }
    if (output.refuseAddress) {
      this.character.rejectedAddresses.push({ value: output.refuseAddress, at });
      this.log.append("address_refused", { address: output.refuseAddress });
      changed = true;
    }
    if (changed) this.#saveCharacter(this.character);
  }
}

function toMessage(event: LogEvent): ChatMessage {
  if (event.type === "talker_output") {
    return { role: "assistant", content: formatAssistantTurn({ thought: (event.thought as string | null) ?? undefined, bubbles: event.bubbles as string[] }) };
  }
  if (event.type === "situation") return { role: "developer", content: String(event.text) };
  return { role: "user", content: String(event.text) };
}

/** 실패를 캐릭터 대사로. 실제 오류는 별도로 UI 배지에 뜬다. 로그인 문제는 대사 없이 배지만. */
export function failureLine(error: ProviderError, language: Language): string | undefined {
  const limited = ["subscription_sharing_usage_limit_exceeded", "rate_limited", "http_429"].includes(error.code) || error.status === 429;
  const network = ["local_unreachable", "stream_interrupted", "network_error"].includes(error.code);
  if (limited) return language === "ko" ? "아 머리아파. 나중에 얘기해" : "ugh, headache. later.";
  if (network) return language === "ko" ? "인터넷 죽었나" : "is the internet dead?";
  return undefined;
}
