// 캐릭터의 영속 상태. M2에서 SQLite 기억으로 옮겨가기 전까지 JSON 파일 하나로 둔다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, writeJsonAtomic } from "../config.js";

export interface NameRecord {
  value: string;
  at: number;
}

export interface CharacterState {
  version: 1;
  /** 집 안으로 데려온 시각. 없으면 아직 집 앞에 앉아 있다. */
  adoptedAt?: number;
  /** 사용자가 지어준 이름. 본명은 여기 없다 — 본인도 말하지 않는다. */
  name?: NameRecord;
  previousNames: NameRecord[];
  rejectedNames: NameRecord[];
  /** 사용자를 부르는 호칭 */
  addressAs?: NameRecord;
  addressHistory: NameRecord[];
  rejectedAddresses: NameRecord[];
}

const FILE = () => join(DATA_DIR, "character.json");

export function emptyCharacter(): CharacterState {
  return { version: 1, previousNames: [], rejectedNames: [], addressHistory: [], rejectedAddresses: [] };
}

export function loadCharacter(file = FILE()): CharacterState {
  if (!existsSync(file)) return emptyCharacter();
  return { ...emptyCharacter(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<CharacterState>) };
}

export function saveCharacter(state: CharacterState, file = FILE()) {
  writeJsonAtomic(file, state);
}

/** 데려온 지 며칠째인가 (데려온 날 = 1일차). */
export function dayCount(state: CharacterState, now: number): number {
  if (!state.adoptedAt) return 0;
  return Math.floor((now - state.adoptedAt) / 86_400_000) + 1;
}
