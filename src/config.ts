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

export interface Config {
  version: 1;
  language: Language;
  layers: Record<LayerName, LayerConfig>;
  /** 페이싱 배속 (2면 두 배 빠름) */
  pace: number;
  showThoughts: boolean;
  attention: AttentionConfig;
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
    local: { baseUrl: "http://127.0.0.1:11434/v1" },
    port: 7717,
  };
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
