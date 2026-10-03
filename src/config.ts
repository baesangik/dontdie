import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_ATTENTION, type AttentionConfig } from "./core/attention.js";

export const ROOT = resolve(import.meta.dirname, "..");
export const DATA_DIR = resolve(process.env.DONTDIE_DATA ?? join(ROOT, "data"));

export type ProviderId = "chatgpt" | "openai" | "anthropic" | "local" | "fake";
export type LayerName = "router" | "talker" | "reasoner";
export const LAYERS: readonly LayerName[] = ["router", "talker", "reasoner"];
export const LANGUAGES = ["ko", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface LayerConfig {
  provider: ProviderId;
  model: string;
  /** reasoning effort. Provider가 지원하지 않으면 무시된다. */
  effort?: string;
}

export type AssistantismMode = "regenerate" | "trim" | "off";
export const ASSISTANTISM_MODES: readonly AssistantismMode[] = ["regenerate", "trim", "off"];

export interface LifeConfig {
  /** 혼자 생활하기 (활동, 잠, 일기). 끄면 대화만 한다. */
  enabled: boolean;
  /** 잠자는 시간 "HH:MM-HH:MM" */
  quietHours: string;
  /** 대화가 끝나고 이만큼 지나면 혼자 뭔가를 시작한다 (분) */
  idleBeforeActivityMin: number;
  /** 하루 먼저 말 걸기 상한 */
  proactivePerDay: number;
}

export interface Config {
  version: 1;
  language: Language;
  layers: Record<LayerName, LayerConfig>;
  /** 페이싱 배속 (2면 두 배 빠름). 활동 시간도 같이 빨라진다. */
  pace: number;
  showThoughts: boolean;
  attention: AttentionConfig;
  /** 계층별 하루 호출 상한 = 체력 */
  budget: { daily: Record<LayerName, number> };
  life: LifeConfig;
  /** 비서 말투가 걸렸을 때: 다시 쓰게 함 / 다듬기만 / 끔 */
  assistantism: AssistantismMode;
  /** web/sprites/<pack>/ */
  spritePack: string;
  local: { baseUrl: string };
  port: number;
}

/** Provider를 바꿨을 때 채워 넣을 계층별 기본 모델. */
export const PROVIDER_DEFAULTS: Record<ProviderId, Record<LayerName, LayerConfig>> = {
  chatgpt: {
    router: { provider: "chatgpt", model: "gpt-6-luna", effort: "none" },
    talker: { provider: "chatgpt", model: "gpt-6-luna", effort: "low" },
    reasoner: { provider: "chatgpt", model: "gpt-6.1-sol", effort: "medium" },
  },
  openai: {
    router: { provider: "openai", model: "gpt-6-luna", effort: "none" },
    talker: { provider: "openai", model: "gpt-6-luna", effort: "low" },
    reasoner: { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
  },
  anthropic: {
    router: { provider: "anthropic", model: "claude-haiku-4-5" },
    talker: { provider: "anthropic", model: "claude-sonnet-5", effort: "low" },
    reasoner: { provider: "anthropic", model: "claude-opus-5", effort: "high" },
  },
  local: {
    router: { provider: "local", model: "" },
    talker: { provider: "local", model: "" },
    reasoner: { provider: "local", model: "" },
  },
  fake: {
    router: { provider: "fake", model: "fake" },
    talker: { provider: "fake", model: "fake" },
    reasoner: { provider: "fake", model: "fake" },
  },
};

export function defaultConfig(): Config {
  return {
    version: 1,
    language: "ko",
    layers: structuredClone(PROVIDER_DEFAULTS.chatgpt),
    pace: 1,
    showThoughts: true,
    attention: { ...DEFAULT_ATTENTION },
    budget: { daily: { router: 800, talker: 400, reasoner: 60 } },
    life: { enabled: true, quietHours: "02:00-08:00", idleBeforeActivityMin: 3, proactivePerDay: 8 },
    assistantism: "regenerate",
    spritePack: "placeholder",
    local: { baseUrl: "http://127.0.0.1:11434/v1" },
    port: 7717,
  };
}

/** "02:00-08:00" 안에 있는가. 자정을 넘는 범위도 된다. */
export function inQuietHours(range: string, now: number): boolean {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(range.trim());
  if (!match) return false;
  const [from, to] = [Number(match[1]) * 60 + Number(match[2]), Number(match[3]) * 60 + Number(match[4])];
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

const CONFIG_FILE = () => join(DATA_DIR, "config.json");

export function loadConfig(file = CONFIG_FILE()): Config {
  const base = defaultConfig();
  if (!existsSync(file)) return base;
  const saved = JSON.parse(readFileSync(file, "utf8")) as Partial<Config>;
  return {
    ...base,
    ...saved,
    layers: { ...base.layers, ...saved.layers },
    attention: { ...base.attention, ...saved.attention },
    budget: { daily: { ...base.budget.daily, ...saved.budget?.daily } },
    life: { ...base.life, ...saved.life },
    local: { ...base.local, ...saved.local },
  };
}

export function saveConfig(config: Config, file = CONFIG_FILE()) {
  writeJsonAtomic(file, config);
}

export function writeJsonAtomic(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, file);
}
