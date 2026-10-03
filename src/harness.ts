// 하네스: 이벤트를 받아 Router → Talker → (Reasoner)를 굴리고, 사람 속도로 말하게 하고, 생활을 돌린다.
// 판정과 타이밍은 하네스가 하고, 말은 Talker가 한다.
//
//   사용자 메시지 → 읽음 → Router(무의식) → 기억/감정/모르는 것 사다리 → Talker(자아) → 말
//                                                       └ 반사 → Reasoner(숙고) → 수정 / 할 말 큐
//   혼자 있을 때 → 생활 스케줄러 → 활동 틱 → 속생각 → 할 말 큐 → 쳐다볼 때/돌아왔을 때 말 걸기

import { ActionRegistry } from "./actions/registry.js";
import type { ActionContext } from "./actions/types.js";
import { Attention, expectsReply, type AttentionChange, type AttentionSignal, type AttentionState } from "./core/attention.js";
import type { Clock } from "./core/clock.js";
import type { EventLog, LogEvent } from "./core/eventlog.js";
import { bubbleGapMs, readDelayMs, typingDelayMs } from "./core/pacing.js";
import type { Config, Language } from "./config.js";
import { dayCount, type CharacterState } from "./character/state.js";
import { describeNow, formatAssistantTurn, runTalker, type TalkerOutput } from "./layers/talker.js";
import { Life, type LifeHost, type RunningActivity } from "./life/scheduler.js";
import type { Memory, MemoryKind, MemoryStore } from "./memory/store.js";
import { bigrams, overlap } from "./memory/text.js";
import { detectAssistantism, humanize, REGENERATE_AT } from "./mind/assistantism.js";
import { Budget, logicalDay } from "./mind/budget.js";
import { ladderCue, memoryLine, noteLine, renderContext, type TurnContext, type TurnKind } from "./mind/context.js";
import { climbLadder, type LadderStep } from "./mind/ladder.js";
import { LINES, pick } from "./mind/lines.js";
import { Mood } from "./mind/mood.js";
import { runReasoner, type LookupNote, type ReasonerNote, type ReasonerTask } from "./mind/reasoner.js";
import { runRouter, type RouterInput } from "./mind/router.js";
import { ruleVerdict } from "./mind/rules.js";
import { SpeechQueue } from "./mind/speech.js";
import { neutralVerdict, type Verdict } from "./mind/verdict.js";
import type { Providers } from "./providers/index.js";
import { asProviderError, type ChatMessage, type ProviderError } from "./providers/types.js";

export const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_TYPES = ["user_message", "situation", "talker_output"] as const;
/** 로그인/키 문제. 이때는 메시지를 처리한 걸로 치지 않고, 로그인 뒤에 이어서 답한다. */
const AUTH_CODES = new Set(["sign_in_required", "sharing_not_enabled", "reauth_required", "no_api_key", "invalid_api_key"]);
const PRESENT: readonly AttentionState[] = ["attending", "engaged", "winding_down"];
/** 혼자 찾아볼 수 있는 궁금증의 종류 */
const SEARCHABLE: readonly string[] = ["slang", "event", "thing", "query"];
/** 이 정도 동기가 있어야 쳐다볼 때 먼저 말을 건다 */
const ATTEND_SPEAK_AT = 0.35;
/** 숙고 결과가 같은 결론이어도 가끔은 "역시 맞네"를 한다 */
const AGREE_REMARK_CHANCE = 0.2;
/** 필러를 말하기 전 기다리는 시간 (배속 전) */
const FILLER_AFTER_MS = 12_000;
/** 바쁠 때 늦게 보는 최대 시간 (배속 전) */
const BUSY_DELAY_MAX_MS = 90_000;
const SEARCH_INTENT = /(찾아\s*볼게|찾아봄|검색해\s*볼게|쳐\s*볼게|ㄱㄷ|잠깐만|잠만|look(ing)? it up|let me check|i'?ll search)/i;

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
  memory: MemoryStore;
  actions?: ActionRegistry;
  random?: () => number;
  saveCharacter?: (state: CharacterState) => void;
  saveConfig?: (config: Config) => void;
}

type Trigger =
  | { kind: "inbox"; line: string; jobId: string }
  | { kind: "filler"; jobId: string }
  | { kind: "attend" }
  | { kind: "return"; awayMs: number; since: number }
  | { kind: "reflect"; activity: string; observation: string; topic: string | null }
  | { kind: "diary" };

export interface Job {
  id: string;
  task: ReasonerTask;
  startedAt: number;
  /** 이 일을 하게 만든 사용자 메시지 id */
  originId: number;
  topic: string | null;
  /** 찾는 단어 (question 기억 key) */
  term: string | null;
  cancelFiller: (() => void) | null;
}

interface TurnInput {
  kind: TurnKind;
  verdict?: Verdict;
  steps?: LadderStep[];
  /** 기억 검색에 쓸 텍스트 */
  query?: string;
  inbox?: string[];
  cues?: string[];
  queue?: boolean;
  task?: string;
  busyActivity?: string | null;
}

export class Harness implements LifeHost {
  readonly clock: Clock;
  readonly log: EventLog;
  readonly providers: Providers;
  readonly attention: Attention;
  readonly memory: MemoryStore;
  readonly mood: Mood;
  readonly budget: Budget;
  readonly speech: SpeechQueue;
  readonly life: Life;
  config: Config;
  character: CharacterState;
  #busy = false;
  #again = false;
  #stalled = false;
  /** Talker에게 이미 넘긴 마지막 user_message / situation 이벤트 id */
  #consumed = 0;
  #triggers: Trigger[] = [];
  #jobs = new Map<string, Job>();
  #jobSeq = 0;
  #lastInteraction: number;
  #lastFiller: string | undefined;
  #random: () => number;
  #saveCharacter: (state: CharacterState) => void;
  #saveConfig: (config: Config) => void;

  constructor(deps: HarnessDeps) {
    this.clock = deps.clock;
    this.log = deps.log;
    this.providers = deps.providers;
    this.config = deps.config;
    this.character = deps.character;
    this.memory = deps.memory;
    this.#random = deps.random ?? Math.random;
    this.#saveCharacter = deps.saveCharacter ?? (() => {});
    this.#saveConfig = deps.saveConfig ?? (() => {});
    const now = this.clock.now();
    this.mood = new Mood(this.memory, now);
    this.budget = new Budget(this.memory, () => this.config, this.clock);
    this.speech = new SpeechQueue(this.memory, this.#random);
    this.life = new Life(this, deps.actions ?? new ActionRegistry(), this.#random);
    this.attention = new Attention(this.clock, this.config.attention, (change) => this.#onAttention(change));
    // 재시작했을 때 예전 메시지에 다시 답하지 않는다.
    const last = this.log.recent(1, ["user_message", "situation"])[0];
    this.#consumed = last?.id ?? 0;
    this.#lastInteraction = this.log.recent(1, ["user_message", "say"])[0]?.t ?? now;
  }

  get busy() { return this.#busy; }
  get adopted() { return Boolean(this.character.adoptedAt); }
  get attentionState(): AttentionState { return this.attention.state; }
  get jobs(): readonly Job[] { return [...this.#jobs.values()]; }

  /** 생활 스케줄러를 켠다. 데려오기 전에는 현관 앞에 앉아만 있다. */
  start() {
    this.life.start();
  }

  stop() {
    this.life.stop();
    this.attention.dispose();
    for (const job of this.#jobs.values()) job.cancelFiller?.();
  }

  /** 현관 앞에 앉아 있던 걸 데려온다. 이미 데려왔으면 아무것도 안 한다. */
  adopt(): boolean {
    if (this.adopted) return false;
    this.character.adoptedAt = this.clock.now();
    this.#saveCharacter(this.character);
    this.log.append("adopt", {});
    this.log.append("situation", { text: SITUATION.adopt[this.config.language] });
    this.memory.add({ kind: "self", content: this.config.language === "ko" ? "비 오는 밤 현관 앞에 있다가 이 집에 들어옴" : "Was brought inside from the front door on a rainy night", source: "self", importance: 0.9 }, this.clock.now());
    this.#kick();
    return true;
  }

  userMessage(text: string) {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!trimmed) return;
    if (!this.adopted) throw new Error("not_adopted");
    this.log.append("user_message", { text: trimmed });
    this.#lastInteraction = this.clock.now();
    this.attention.signal("sent");
    this.life.pause();
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
    // 대답 턴은 침묵(속생각만)도 남긴다. 먼저 말 걸기를 하려다 만 턴은 뺀다.
    const events = this.log.recent(600, HISTORY_TYPES).filter((event) => event.type !== "talker_output" || (event.bubbles as string[]).length > 0 || (event.kind ?? "reply") === "reply");
    const keyed = events.map((event) => ({ key: event.type === "talker_output" ? Number(event.replyTo ?? event.id) + 0.5 : event.id, event }));
    keyed.sort((a, b) => a.key - b.key || a.event.id - b.event.id);
    return keyed.slice(-limit).map(({ event }) => toMessage(event));
  }

  /** 로그인 등으로 막혀 있던 답을 다시 시도한다. */
  resume() {
    this.#kick();
  }

  async whenIdle() {
    while (this.#busy) await new Promise((resolve) => setImmediate(resolve));
  }

  // ── LifeHost ──

  lastInteractionAt() { return this.#lastInteraction; }
  energy() { return this.budget.energy(); }

  actionContext(signal: AbortSignal, topic?: string): ActionContext {
    return {
      clock: this.clock,
      language: this.config.language,
      ...(topic ? { topic } : {}),
      signal,
      fetchText: async () => { throw new Error("fetchText: no sources are allowed yet"); },
      // 혼자 찾아볼 수 있는 것만: 신조어, 소식, 물건. 사람/장소는 검색해도 안 나오고, 막연한 건 찾을 게 없다.
      questions: () => this.#openQuestions()
        .filter((question) => SEARCHABLE.includes(String(question.meta.termKind)) && question.meta.stage !== "searching" && !question.meta.failed)
        .reverse()
        .map((question) => ({ term: question.key!, context: question.content })),
      lookup: async (query, hint) => {
        if (!this.budget.canCall("reasoner")) return null;
        return await this.#lookupNow(query, hint ?? null, query) ?? null;
      },
      random: this.#random,
    };
  }

  reflect(activity: RunningActivity, observation: string) {
    this.#trigger({ kind: "reflect", activity: activity.label, observation, topic: activity.topic ?? null });
  }

  activityEnded(activity: RunningActivity, reason: string) {
    if (activity.energyCost < 0 && reason === "done") this.budget.napped(-activity.energyCost);
    if (reason === "done" && activity.kind !== "zone_out") {
      this.memory.add({ kind: "episode", content: this.config.language === "ko" ? `혼자 ${activity.summary}` : `${activity.summary} alone`, source: "activity", importance: 0.2, topic: activity.topic ?? null }, this.clock.now());
    }
  }

  sleepStarted() {
    const now = this.clock.now();
    const forgotten = this.memory.forgetWeak(now);
    for (const memory of forgotten) this.log.append("memory", { op: "forgot", kind: memory.kind, key: memory.key, content: memory.content });
    const { dropped, forgot } = this.speech.decay(now, LINES[this.config.language].forgot);
    for (const item of dropped) this.log.append("speech", { op: "dropped", text: item.text });
    if (forgot) this.log.append("speech", { op: "forgot", text: forgot.text });
  }

  wokeUp() {
    this.mood.reset(this.clock.now());
  }

  diaryDue(): boolean {
    const now = this.clock.now();
    const hour = new Date(now).getHours();
    if (!(hour >= 21 || hour < 2) || !this.adopted) return false;
    if (this.memory.getValue<string>("diary_day") === logicalDay(now)) return false;
    // 오늘 있었던 일이 없으면 안 쓴다.
    return this.log.recent(400, ["user_message", "activity"]).some((event) => logicalDay(event.t) === logicalDay(now));
  }

  writeDiary() {
    this.memory.setValue("diary_day", logicalDay(this.clock.now()));
    this.#trigger({ kind: "diary" });
  }

  // ── 루프 ──

  #kick() {
    this.#stalled = false;
    if (this.#busy) {
      this.#again = true;
      return;
    }
    void this.#loop();
  }

  #trigger(trigger: Trigger) {
    this.#triggers.push(trigger);
    this.#kick();
  }

  async #loop() {
    this.#busy = true;
    try {
      do {
        this.#again = false;
        if (this.#unanswered().length > 0) await this.#reply();
        else {
          const trigger = this.#triggers.shift();
          if (trigger) await this.#runTrigger(trigger);
        }
      } while (!this.#stalled && (this.#again || this.#unanswered().length > 0 || this.#triggers.length > 0));
    } catch (error) {
      this.log.append("error", { layer: "harness", message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.#busy = false;
    }
  }

  #unanswered(): LogEvent[] {
    return this.log.recent(50, ["user_message", "situation"]).filter((event) => event.id > this.#consumed);
  }

  // ── 대답 ──

  async #reply() {
    const fresh = this.#unanswered();
    if (fresh.length === 0) return;
    const pace = this.config.pace;
    const language = this.config.language;
    const userText = fresh.filter((event) => event.type === "user_message").map((event) => String(event.text)).join("\n");

    // Router(무의식)는 읽는 동안 같이 돈다. 사람도 읽으면서 이미 느낀다.
    const early = userText ? this.#judge(userText, fresh[0]!.id) : null;
    if (userText) {
      await this.clock.sleep(readDelayMs(userText, pace));
      this.log.append("seen", { upTo: fresh[fresh.length - 1]!.id });
    }

    // 읽는 동안 메시지가 더 왔을 수 있다. 지금까지 온 것까지 넘긴다.
    const batch = this.#unanswered();
    const replyTo = batch[batch.length - 1]!.id;
    const previous = this.#consumed;
    this.#consumed = replyTo;
    const text = batch.filter((event) => event.type === "user_message").map((event) => String(event.text)).join("\n");

    let verdict = neutralVerdict();
    if (text) {
      const judged = early && text === userText ? await early : await this.#judge(text, batch[0]!.id);
      verdict = this.#absorb(judged);
    }
    const steps = text ? this.#ladder(verdict) : [];

    // 바쁠 때 (MECHANISMS §6): 하던 일이 잘 안 끊기는 거면 "잠깐 이것만" 하고 늦게 본다. 급한 건 바로.
    const activity = this.life.current;
    let busyActivity: string | null = null;
    if (text && activity && verdict.salience < 0.7 && this.#random() > activity.interruptibility) {
      busyActivity = activity.label;
      const delay = Math.min(BUSY_DELAY_MAX_MS, 20_000 + this.#random() * 60_000) / pace;
      this.log.append("busy", { activity: activity.kind, ms: Math.round(delay) });
      await this.clock.sleep(delay);
    }

    // 중요한 일은 반사로 결론 내지 않고, 바로 뒤에서 생각을 시작한다.
    if (verdict.stakes === "critical") this.#startThink(text, null, replyTo, verdict.topic, true);

    const inbox = this.#drainInbox();
    // 대화가 끝나가면 할 말 후보를 같이 보여준다 ("아 그리고 아까 그거").
    const withQueue = verdict.closure >= 0.6;
    const queued = withQueue ? this.speech.top(this.clock.now(), 0.3).slice(0, 2) : [];
    const result = await this.#talk({ kind: "reply", verdict, steps, query: text, inbox, busyActivity, queue: withQueue }, replyTo);
    if (!result.ok) {
      if (result.auth) {
        this.#consumed = previous;
        this.#stalled = true;
      }
      return;
    }
    const output = result.output;
    await this.#act(output, { verdict, steps, userText: text, replyTo });
    const spoken = queued.filter((item) => saidSimilar(output.bubbles, item.text)).map((item) => item.id);
    if (spoken.length) this.#spoke(spoken, "reply");

    // 반사 → 숙고 → 수정 (MECHANISMS §2)
    if (verdict.stakes === "high" && !output.consult && output.bubbles.length) {
      this.#startThink(text, output.bubbles.join(" "), replyTo, verdict.topic, false);
    }

    if (text) {
      this.attention.botReplied({ closure: verdict.closure, expectsReply: expectsReply(output.bubbles) });
      if (verdict.leaving) this.attention.leaving();
    }
  }

  /** Router(무의식): 판정만 한다. 효과(감정, 기억)는 #absorb에서. */
  async #judge(text: string, beforeId: number): Promise<{ verdict: Verdict; ms: number; fallback?: string }> {
    const language = this.config.language;
    const layer = this.config.layers.router;
    const recent = this.log.recent(40, ["user_message", "talker_output"])
      .filter((event) => event.id < beforeId)
      .slice(-10)
      .flatMap((event): RouterInput["recent"] => event.type === "user_message"
        ? [{ who: "person", text: String(event.text) }]
        : (event.bubbles as string[]).length ? [{ who: "me", text: (event.bubbles as string[]).join(" / ") }] : []);
    const input: RouterInput = {
      language,
      text,
      recent,
      characterName: this.character.name?.value,
      addressAs: this.character.addressAs?.value,
      knownKeys: this.memory.list({ kinds: ["person", "knowledge", "pref"], limit: 80 }).map((memory) => memory.key).filter((key): key is string => Boolean(key)),
      openQuestions: this.#openQuestions().slice(0, 8).map((question) => ({ term: question.key!, kind: String(question.meta.termKind ?? "other") })),
    };

    let result;
    if (this.budget.canCall("router")) {
      result = await runRouter(input, layer, this.providers.get(layer.provider));
      this.budget.record("router");
      this.log.append("llm_call", { layer: "router", provider: layer.provider, model: layer.model, ms: result.ms, ok: !result.fallback, ...(result.fallback ? { code: result.fallback } : {}) });
    } else {
      result = { verdict: ruleVerdict(text, language), ms: 0, fallback: "budget" };
    }
    return result;
  }

  /** 판정을 받아들인다: 감정, 배운 것, 기억할 일, 주제. */
  #absorb(result: { verdict: Verdict; ms: number; fallback?: string }): Verdict {
    const now = this.clock.now();
    const verdict = result.verdict;
    this.log.append("router", { verdict, ms: result.ms, fallback: result.fallback ?? null });

    this.mood.apply(verdict, now);
    if (verdict.topic) {
      this.memory.recordTopic(verdict.topic, now);
    }
    for (const teaching of verdict.teaching) this.#learn(teaching.term, teaching.kind, teaching.fact, "user");
    if (verdict.gist && verdict.importance >= 0.3) {
      const memory = this.memory.add({ kind: "episode", content: verdict.gist, source: "user", importance: verdict.importance, topic: verdict.topic }, now);
      this.log.append("memory", { op: "remembered", kind: "episode", key: null, content: memory.content });
    }
    return verdict;
  }

  /** 배운 것을 기억에 넣는다. 물어봤던 거면 질문을 닫는다. */
  #learn(term: string, kind: string, fact: string, source: string, meta: Record<string, unknown> = {}) {
    const now = this.clock.now();
    const memoryKind: MemoryKind = kind === "person" || kind === "place" ? "person" : kind === "pref" ? "pref" : "knowledge";
    const importance = memoryKind === "person" ? 0.8 : memoryKind === "pref" ? 0.7 : 0.6;
    const { memory, created } = this.memory.upsertFact({ kind: memoryKind, key: term, content: fact, source, importance, meta: { ...meta, termKind: kind } }, now);
    this.log.append("memory", { op: created ? "learned" : "reinforced", kind: memoryKind, key: term, content: memory.content, source });
    const question = this.memory.findByKey(["question"], term);
    if (question) this.memory.forget(question.id, now);
  }

  #openQuestions(): Memory[] {
    return this.memory.list({ kinds: ["question"], limit: 50 });
  }

  #ladder(verdict: Verdict): LadderStep[] {
    const steps = climbLadder({
      verdict,
      userPresent: true,
      canSearch: this.budget.canCall("reasoner"),
      recall: (term) => this.memory.findByKey(["person", "knowledge"], term),
      question: (term) => this.memory.findByKey(["question"], term),
      openQuestions: this.#openQuestions(),
    });
    if (steps.length) this.log.append("ladder", { steps: steps.map((step) => ({ term: step.term, kind: step.kind, stage: step.stage, ...(step.query ? { query: step.query } : {}), ...(step.hint ? { hint: step.hint } : {}) })) });
    return steps;
  }

  // ── Talker ──

  async #talk(input: TurnInput, replyTo: number | null): Promise<{ ok: true; output: TalkerOutput } | { ok: false; auth: boolean }> {
    const language = this.config.language;
    const layer = this.config.layers.talker;
    if (!this.budget.canCall("talker")) {
      this.log.append("budget", { layer: "talker", exhausted: true });
      return { ok: true, output: { bubbles: input.kind === "reply" ? [LINES[language].exhausted] : [], tells: [], face: "sleepy" } };
    }
    const context = this.#context(input);
    const messages = this.history();
    this.log.append("thinking", { on: true, kind: input.kind });
    const started = Date.now();
    try {
      const call = async (nudge?: string) => {
        const result = await runTalker({
          layer, provider: this.providers.get(layer.provider), language, character: this.character,
          messages, context: renderContext(context, language), ...(nudge ? { nudge } : {}),
        });
        this.budget.record("talker");
        this.log.append("llm_call", { layer: "talker", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: true, kind: input.kind });
        return result.output;
      };
      let output = await call();
      const mode = this.config.assistantism;
      if (mode !== "off" && output.bubbles.length) {
        const report = detectAssistantism(output.bubbles, language);
        if (report.score >= REGENERATE_AT && mode === "regenerate" && this.budget.canCall("talker")) {
          this.log.append("assistantism", { score: report.score, hits: report.hits, action: "regenerate", before: output.bubbles });
          const retry = await call(nudgeFor(report.hits, language));
          if (detectAssistantism(retry.bubbles, language).score < report.score || !retry.bubbles.length) output = retry;
        } else if (report.score > 0) {
          this.log.append("assistantism", { score: report.score, hits: report.hits, action: "trim" });
        }
        output.bubbles = humanize(output.bubbles, language);
      }
      return { ok: true, output };
    } catch (error) {
      const failure = asProviderError(error);
      this.log.append("llm_call", { layer: "talker", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: false, code: failure.code });
      this.log.append("error", { layer: "talker", ...failure.toJSON() });
      if (AUTH_CODES.has(failure.code)) return { ok: false, auth: true };
      if (input.kind === "reply") {
        const line = failureLine(failure, language);
        if (line) await this.#speak([line]);
        if (replyTo !== null) this.attention.botReplied({ closure: 0.5, expectsReply: false });
      }
      return { ok: false, auth: false };
    } finally {
      this.log.append("thinking", { on: false });
    }
  }

  #context(input: TurnInput): TurnContext {
    const now = this.clock.now();
    const language = this.config.language;
    const lines = LINES[language];
    const verdict = input.verdict;
    const cues: string[] = [...(input.cues ?? [])];
    const memories = new Map<number, Memory>();

    for (const step of input.steps ?? []) {
      if (step.memory) memories.set(step.memory.id, step.memory);
      const cue = ladderCue(step, language);
      if (cue) cues.push(cue);
    }
    if (input.query) {
      const extra = (input.steps ?? []).map((step) => step.term).join(" ");
      for (const memory of this.memory.search(`${input.query} ${extra}`, now, { kinds: ["person", "knowledge", "episode", "self"], limit: 5, topic: verdict?.topic ?? null })) {
        memories.set(memory.id, memory);
      }
    }
    // 꺼내 쓴 기억은 강해진다.
    this.memory.touch([...memories.keys()], now);

    if (verdict) {
      if (verdict.pressure === "scoff") cues.push(lines.cue.scoff);
      if (verdict.pressure === "insist") cues.push(lines.cue.insist);
      if (verdict.stakes === "high") cues.push(lines.cue.high);
      if (verdict.stakes === "critical") cues.push(lines.cue.critical);
      if (verdict.topic) {
        const count = this.memory.topicCount(verdict.topic, now - 7 * 86_400_000);
        if (count >= 3) cues.push(lines.cue.repeat(verdict.topic, count));
      }
    }
    for (const job of this.#jobs.values()) {
      cues.push(job.task.kind === "lookup" ? lines.cue.searching(job.task.query) : lines.cue.thinking(job.task.question));
    }
    if (input.busyActivity) cues.push(lines.cue.busy(input.busyActivity));
    if (this.life.asleep) cues.push(lines.cue.asleep);
    else if (this.budget.energy() < 0.3) cues.push(lines.cue.tired);

    const queue = input.queue ? this.speech.top(now, 0.3).slice(0, 2).map((item) => item.text) : [];
    return {
      kind: input.kind,
      now: describeNow(now, language, this.character),
      mood: this.mood.describe(now, language),
      energy: this.budget.describe(language),
      activity: input.kind === "reflect" ? null : this.life.describe(lines.activityProgress),
      asleep: this.life.asleep,
      addressAs: this.character.addressAs?.value ?? null,
      prefs: this.memory.list({ kinds: ["pref"], limit: 5 }).map((memory) => memory.content),
      memories: [...memories.values()].map((memory) => memoryLine(memory, now, language)),
      inbox: input.inbox ?? [],
      cues,
      queue,
      task: input.task,
    };
  }

  /** Talker 출력대로 행동한다: 이름/호칭, 표정, 말, 검색, 궁금증, 할 말. */
  async #act(output: TalkerOutput, info: { verdict?: Verdict; steps?: LadderStep[]; userText?: string; replyTo: number | null; kind?: TurnKind }) {
    const now = this.clock.now();
    this.#applyIdentity(output);
    if (output.face) this.log.append("face", { face: output.face });
    this.log.append("talker_output", { replyTo: info.replyTo, kind: info.kind ?? "reply", thought: output.thought ?? null, bubbles: output.bubbles });
    if (output.thought) this.log.append("thought", { text: output.thought });
    await this.#speak(output.bubbles);

    const steps = info.steps ?? [];
    // 물어본 것은 열린 질문으로 남긴다. 답을 들으면 Router의 teaching이 닫는다.
    for (const step of steps) {
      if (step.stage !== "ask" && step.stage !== "unsearchable" && step.stage !== "guess") continue;
      const asked = output.bubbles.some((bubble) => bubble.includes(step.term) || /[?？]/.test(bubble));
      this.#question(step.term, step.kind, info.userText ?? "", asked ? "asked" : "later");
    }

    // 검색: Talker가 <consult>로 정했거나, 찾아보라고 했고 "찾아볼게"라고 말했다.
    const searchStep = steps.find((step) => step.stage === "search");
    let consult = output.consult;
    if (!consult && searchStep && output.bubbles.some((bubble) => SEARCH_INTENT.test(bubble))) consult = searchStep.query ?? searchStep.term;
    if (consult) {
      const term = searchStep?.term ?? consult;
      this.#question(term, searchStep?.kind ?? "query", info.userText ?? consult, "searching");
      this.#startLookup(consult, searchStep?.hint ?? info.verdict?.search.hint ?? null, info.userText ?? consult, info.replyTo ?? 0, term, info.verdict?.topic ?? null);
    }
    if (output.later) this.#question(output.later, "other", info.userText ?? "", "later");
    for (const tell of output.tells) {
      const item = this.speech.add({ text: tell, about: null, m0: 0.6, tau: 4 * 3_600_000, source: "tell" }, now);
      this.log.append("speech", { op: "queued", text: item.text, m0: item.m0 });
    }
  }

  #question(term: string, kind: string, context: string, stage: "asked" | "later" | "searching") {
    const now = this.clock.now();
    const existing = this.memory.findByKey(["question"], term);
    if (existing) {
      this.memory.update(existing.id, { meta: { stage, askedCount: Number(existing.meta.askedCount ?? 0) + (stage === "asked" ? 1 : 0) } });
      return;
    }
    if (this.memory.findByKey(["person", "knowledge"], term)) return;
    this.memory.add({ kind: "question", key: term, content: context.slice(0, 200), source: "self", importance: 0.5, meta: { termKind: kind, stage, askedCount: stage === "asked" ? 1 : 0 } }, now);
    this.log.append("memory", { op: "wondering", kind: "question", key: term, content: stage });
  }

  // ── 트리거 (받은 소식, 먼저 말 걸기, 혼자 생각, 일기) ──

  async #runTrigger(trigger: Trigger) {
    const language = this.config.language;
    const lines = LINES[language];
    switch (trigger.kind) {
      case "filler": {
        const job = this.#jobs.get(trigger.jobId);
        if (!job || !PRESENT.includes(this.attention.state)) return;
        const pool = job.task.kind === "lookup" ? lines.filler.lookup : lines.filler.think;
        const line = pick(pool, this.#random, this.#lastFiller);
        this.#lastFiller = line;
        this.log.append("filler", { jobId: job.id, text: line });
        await this.#speak([line]);
        return;
      }
      case "inbox": {
        // 이미 다른 대답에 실려 나갔으면 끝.
        const lines = this.#drainInbox(trigger.jobId);
        if (!lines.length) return;
        const result = await this.#talk({ kind: "inbox", inbox: lines, task: LINES[language].task.inbox }, this.#lastUserId());
        if (result.ok) await this.#act(result.output, { replyTo: this.#lastUserId(), kind: "inbox" });
        return;
      }
      case "attend": {
        if (!this.#canProactive()) return;
        const top = this.speech.top(this.clock.now(), ATTEND_SPEAK_AT);
        if (!top.length) return;
        const result = await this.#talk({ kind: "attend", queue: true, task: lines.task.attend }, this.#lastUserId());
        if (!result.ok) return;
        await this.#act(result.output, { replyTo: this.#lastUserId(), kind: "attend" });
        if (result.output.bubbles.length) this.#spoke(top.slice(0, 2).map((item) => item.id), "attend");
        return;
      }
      case "return": {
        if (!this.#canProactive()) return;
        const did = this.#didWhileAway(trigger.since);
        const result = await this.#talk({ kind: "return", queue: true, task: lines.task.return(Math.round(trigger.awayMs / 60_000), did) }, this.#lastUserId());
        if (!result.ok) return;
        await this.#act(result.output, { replyTo: this.#lastUserId(), kind: "return" });
        if (result.output.bubbles.length) this.#spoke(this.speech.top(this.clock.now(), 0.3).slice(0, 2).map((item) => item.id), "return");
        return;
      }
      case "reflect": {
        const result = await this.#talk({ kind: "reflect", query: trigger.observation, task: lines.task.reflect(trigger.activity, trigger.observation) }, null);
        if (!result.ok) return;
        const output = result.output;
        // 혼자 있을 때는 말하지 않는다. 말풍선이 나왔으면 할 말 큐로 보낸다.
        const tells = [...output.tells, ...output.bubbles];
        if (output.thought) this.log.append("thought", { text: output.thought, alone: true });
        for (const tell of tells) {
          const item = this.speech.add({ text: tell, about: trigger.topic, m0: 0.55, tau: 5 * 3_600_000, source: "activity" }, this.clock.now());
          this.log.append("speech", { op: "queued", text: item.text, m0: item.m0 });
        }
        if (output.later) this.#question(output.later, "other", trigger.observation, "later");
        return;
      }
      case "diary": {
        await this.#diary();
        return;
      }
    }
  }

  async #diary() {
    const now = this.clock.now();
    const language = this.config.language;
    const today = logicalDay(now);
    const episodes = this.memory.list({ kinds: ["episode"], limit: 40 }).filter((memory) => logicalDay(memory.createdAt) === today).reverse();
    const learned = this.memory.list({ kinds: ["knowledge", "person"], limit: 40 }).filter((memory) => logicalDay(memory.createdAt) === today);
    const said = this.log.recent(300, ["user_message"]).filter((event) => logicalDay(event.t) === today).length;
    const events = [
      ...episodes.map((memory) => `- ${memory.content}`),
      ...learned.map((memory) => `- ${language === "ko" ? "새로 앎" : "learned"}: ${memory.key} = ${memory.content}`),
      `- ${language === "ko" ? `이 집 사람이 말 건 횟수: ${said}` : `messages from the person: ${said}`}`,
      `- ${language === "ko" ? `이 집에 온 지 ${dayCount(this.character, now)}일째` : `day ${dayCount(this.character, now)} here`}`,
    ].join("\n");
    const result = await this.#talk({ kind: "reflect", task: LINES[language].task.diary(events) }, null);
    if (!result.ok) return;
    const text = [...result.output.bubbles, ...result.output.tells].join("\n").trim();
    if (!text) return;
    this.memory.add({ kind: "diary", content: text, source: "self", importance: 1, meta: { day: today } }, now);
    this.log.append("diary", { day: today, text });
  }

  #canProactive(): boolean {
    const today = logicalDay(this.clock.now());
    const count = this.log.recent(400, ["proactive"]).filter((event) => logicalDay(event.t) === today).length;
    return count < this.config.life.proactivePerDay && !this.life.asleep;
  }

  #spoke(ids: string[], reason: string) {
    for (const id of ids) {
      const item = this.speech.take(id);
      if (item) this.log.append("speech", { op: "said", text: item.text });
    }
    this.log.append("proactive", { reason });
  }

  #didWhileAway(since: number): string | null {
    const ended = this.log.recent(200, ["activity"]).filter((event) => event.t >= since && event.phase === "end" && event.reason === "done" && event.kind !== "zone_out");
    const summaries = [...new Set(ended.map((event) => String(event.summary ?? event.label)))].slice(-2);
    return summaries.length ? summaries.join(", ") : null;
  }

  #lastUserId(): number {
    return this.log.recent(1, ["user_message", "situation"])[0]?.id ?? 0;
  }

  // ── Reasoner 작업 ──

  #inboxLines = new Map<string, string>();

  /** 아직 Talker에 안 넘긴 Reasoner 결과를 꺼낸다 (jobId를 주면 그것만). */
  #drainInbox(jobId?: string): string[] {
    const ids = jobId ? [jobId] : [...this.#inboxLines.keys()];
    const lines: string[] = [];
    for (const id of ids) {
      const line = this.#inboxLines.get(id);
      if (line) lines.push(line);
      this.#inboxLines.delete(id);
    }
    return lines;
  }

  #startLookup(query: string, hint: string | null, context: string, originId: number, term: string | null, topic: string | null) {
    void this.#lookupNow(query, hint, context, { originId, term, topic, deliver: true });
  }

  /** 찾아본다. 찾은 건 지식으로 남기고 질문을 닫는다. deliver면 결과를 Talker에게 보낸다. */
  async #lookupNow(query: string, hint: string | null, context: string, origin: { originId: number; term: string | null; topic: string | null; deliver: boolean } = { originId: 0, term: query, topic: null, deliver: false }): Promise<LookupNote | undefined> {
    const language = this.config.language;
    const job = this.#newJob({ kind: "lookup", query, hint, context }, origin.originId, origin.term, origin.topic, origin.deliver);
    if (!job) {
      if (origin.deliver) this.#deliver("budget", LINES[language].tooTiredToSearch(query), origin.originId, origin.term);
      if (origin.term) this.#question(origin.term, "other", context, "later");
      return undefined;
    }
    const note = await this.#runJob(job) as LookupNote | undefined;
    if (!note) {
      if (origin.term) this.#question(origin.term, "other", context, "later");
      return undefined;
    }
    const term = origin.term ?? query;
    const kind = String(this.memory.findByKey(["question"], term)?.meta.termKind ?? "other");
    if (note.found) {
      this.#learn(term, kind === "query" ? "other" : kind, note.answer, "search", { query, hint, sources: note.sources.map((source) => source.url) });
      this.mood.feel(language === "ko" ? "뿌듯" : "pleased", 0.1, this.clock.now());
    } else {
      this.mood.feel(language === "ko" ? "시무룩" : "deflated", -0.15, this.clock.now());
      const question = this.memory.findByKey(["question"], term);
      if (question) this.memory.update(question.id, { meta: { stage: "later", failed: true } });
    }
    if (origin.deliver) this.#deliver(job.id, noteLine(note, language), origin.originId, term);
    return note;
  }

  #startThink(question: string, reflex: string | null, originId: number, topic: string | null, critical: boolean) {
    const context = this.#thinkContext(question);
    // 반사 답을 이미 했으면 기다리게 한 게 아니므로 필러를 안 한다. 중요한 일(critical)은 기다리게 했으니 한다.
    const job = this.#newJob({ kind: "think", question, reflex, context, critical }, originId, null, topic, critical);
    if (!job) return;
    void this.#runJob(job).then((note) => {
      if (!note || note.kind !== "think") return;
      const line = noteLine(note, this.config.language);
      if (note.reflex && note.agrees !== false) {
        // 같은 결론이면 대부분 조용히 넘어간다.
        const remark = this.#random() < AGREE_REMARK_CHANCE;
        this.log.append("revise", { decision: remark ? "remark" : "keep", conclusion: note.conclusion });
        if (remark) this.#deliver(job.id, line, originId, null);
        return;
      }
      this.log.append("revise", { decision: note.reflex ? "revise" : "answer", conclusion: note.conclusion });
      this.#deliver(job.id, line, originId, null, note.reflex ? 0.75 : 0.85, topic);
    });
  }

  #thinkContext(question: string): string {
    const now = this.clock.now();
    const language = this.config.language;
    const known = this.memory.search(question, now, { kinds: ["person", "pref", "episode", "knowledge"], limit: 6 }).map((memory) => `- ${memoryLine(memory, now, language)}`);
    const recent = this.history(8).filter((message) => message.role !== "developer").map((message) => `${message.role === "user" ? "person" : "creature"}: ${message.content.replace(/<think>[\s\S]*?<\/think>\n?/, "").replace(/\n/g, " / ")}`);
    return [...known, "", "Recent conversation:", ...recent].join("\n");
  }

  /**
   * 결과를 전한다. 대화가 아직 그 얘기 중이면 바로 (받은 소식), 이미 넘어갔거나 자리에 없으면 할 말 큐로.
   * "대화가 넘어갔다" = 이 일을 시킨 메시지 뒤로 사용자 메시지가 2개 넘게 왔다.
   */
  #deliver(jobId: string, line: string, originId: number, about: string | null, m0 = 0.6, topic: string | null = null) {
    const newer = this.log.recent(50, ["user_message"]).filter((event) => event.id > originId).length;
    if (PRESENT.includes(this.attention.state) && newer <= 2) {
      this.#inboxLines.set(jobId, line);
      this.#trigger({ kind: "inbox", line, jobId });
    } else {
      const item = this.speech.add({ text: line, about: about ?? topic, m0, tau: 3 * 3_600_000, source: "reasoner" }, this.clock.now());
      this.log.append("speech", { op: "queued", text: item.text, m0: item.m0 });
    }
  }

  #newJob(task: ReasonerTask, originId: number, term: string | null, topic: string | null, filler: boolean): Job | null {
    if (!this.budget.canCall("reasoner")) {
      this.log.append("budget", { layer: "reasoner", exhausted: true });
      return null;
    }
    const job: Job = { id: `j${++this.#jobSeq}`, task, startedAt: this.clock.now(), originId, term, topic, cancelFiller: null };
    this.#jobs.set(job.id, job);
    this.log.append("consult", { state: "start", jobId: job.id, kind: task.kind, query: task.kind === "lookup" ? task.query : task.question, hint: task.kind === "lookup" ? task.hint : null });
    // 기다리는 동안 커버 치기 (MECHANISMS §3)
    if (filler && PRESENT.includes(this.attention.state)) {
      job.cancelFiller = this.clock.setTimeout(() => {
        job.cancelFiller = null;
        if (this.#jobs.has(job.id)) this.#trigger({ kind: "filler", jobId: job.id });
      }, FILLER_AFTER_MS / this.config.pace);
    }
    return job;
  }

  async #runJob(job: Job): Promise<ReasonerNote | undefined> {
    const layer = this.config.layers.reasoner;
    const started = Date.now();
    try {
      const note = await runReasoner(job.task, { layer, provider: this.providers.get(layer.provider), language: this.config.language });
      this.budget.record("reasoner");
      this.log.append("llm_call", { layer: "reasoner", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: true, kind: job.task.kind });
      this.log.append("consult", { state: "done", jobId: job.id, kind: job.task.kind, note });
      return note;
    } catch (error) {
      const failure = asProviderError(error);
      this.budget.record("reasoner");
      this.log.append("llm_call", { layer: "reasoner", provider: layer.provider, model: layer.model, ms: Date.now() - started, ok: false, code: failure.code });
      this.log.append("consult", { state: "failed", jobId: job.id, kind: job.task.kind, code: failure.code });
      this.log.append("error", { layer: "reasoner", ...failure.toJSON() });
      return undefined;
    } finally {
      job.cancelFiller?.();
      this.#jobs.delete(job.id);
    }
  }

  // ── 주의 ──

  #onAttention(change: AttentionChange) {
    this.log.append("attention", { ...change });
    if (!this.adopted) return;
    if (change.to === "engaged" || change.to === "attending") this.life.pause();
    if (change.reason === "fizzle_unanswered") this.log.append("thought", { text: LINES[this.config.language].noReply, canned: true });
    if (change.from === "away" && change.greet && change.awayMs) {
      this.#trigger({ kind: "return", awayMs: this.clock.now() - (change.leftAt ?? this.clock.now() - change.awayMs), since: change.leftAt ?? this.clock.now() - change.awayMs });
    } else if (change.to === "attending" && this.speech.top(this.clock.now(), ATTEND_SPEAK_AT).length) {
      this.#trigger({ kind: "attend" });
    }
  }

  // ── 말하기 ──

  async #speak(bubbles: string[]) {
    const pace = this.config.pace;
    for (const [index, text] of bubbles.entries()) {
      this.log.append("typing", { on: true });
      await this.clock.sleep(typingDelayMs(text, pace));
      this.log.append("say", { text });
      if (index < bubbles.length - 1) await this.clock.sleep(bubbleGapMs(pace));
    }
    if (bubbles.length) {
      this.log.append("typing", { on: false });
      this.#lastInteraction = this.clock.now();
    }
  }

  #applyIdentity(output: TalkerOutput) {
    const at = this.clock.now();
    const language = this.config.language;
    let changed = false;
    if (output.acceptName && output.acceptName !== this.character.name?.value) {
      if (this.character.name) this.character.previousNames.push(this.character.name);
      const rejected = this.character.rejectedNames.map((entry) => entry.value);
      this.character.name = { value: output.acceptName, at };
      this.log.append("name_given", { name: output.acceptName });
      this.memory.add({ kind: "self", content: language === "ko"
        ? `${dayCount(this.character, at)}일차: 이 집 사람이 '${output.acceptName}'이라는 이름을 지어줌${rejected.length ? ` (${rejected.join(", ")} 거절한 뒤)` : ""}`
        : `Day ${dayCount(this.character, at)}: got the name '${output.acceptName}'${rejected.length ? ` (after refusing ${rejected.join(", ")})` : ""}`, source: "self", importance: 1 }, at);
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

function nudgeFor(hits: string[], language: Language): string {
  return language === "ko"
    ? `(방금 답은 비서처럼 들렸다: ${hits.join(", ")}. 같은 마음을 메신저 말투로 짧게 다시 써라. 설명하지 말고, 질문으로 되묻지 말고, 서비스 멘트 없이. 형식은 그대로.)`
    : `(That reply sounded like an assistant: ${hits.join(", ")}. Rewrite the same thing briefly, like texting. No explaining, no asking back, no service phrases. Same format.)`;
}

/** 실패를 캐릭터 대사로. 실제 오류는 별도로 UI 배지에 뜬다. 로그인 문제는 대사 없이 배지만. */
export function failureLine(error: ProviderError, language: Language): string | undefined {
  const limited = ["subscription_sharing_usage_limit_exceeded", "rate_limited", "http_429"].includes(error.code) || error.status === 429;
  const network = ["local_unreachable", "stream_interrupted", "network_error"].includes(error.code);
  if (limited) return LINES[language].headache;
  if (network) return LINES[language].offline;
  return undefined;
}

/** 대화 기록과 겹치는지 (할 말 큐에서 이미 말한 걸 지울 때) */
export function saidSimilar(bubbles: string[], text: string): boolean {
  return overlap(bigrams(text), bigrams(bubbles.join(" "))) > 0.35;
}

