// 행동 모듈. 혼자 있을 때 하는 일(뉴스 구경, 위키 토끼굴, 멍때리기 …)은 전부 이 인터페이스로 꽂는다.
// 콘텐츠 소스도 행동이다: 소스 하나 = 행동 모듈 하나. 하나씩 늘려가면 된다.
//
// 스케줄러(M3)가 활동 블록을 잡으면, 계획 시간 동안 tick()을 드문드문 몇 번만 부른다.
// 틱 사이에는 UI가 sprite와 라벨만 보여준다. 혼자 하는 행동은 읽기 전용이다.

import type { Clock } from "../core/clock.js";
import type { Language } from "../config.js";

export interface ActionContext {
  clock: Clock;
  language: Language;
  /** 활동 주제 (없을 수 있다) */
  topic?: string;
  signal: AbortSignal;
  /** 허용 목록을 거치는 읽기 전용 fetch. 모듈은 fetch를 직접 쓰지 않는다. */
  fetchText(url: string): Promise<string>;
}

export interface TickResult {
  /** Talker에게 보여줄 관찰 ("기사 제목: …"). 속생각의 재료가 된다. 없으면 이번 틱은 호출 0회. */
  observation?: string;
  /** 관심사 갱신과 반복 감지용 주제 태그 */
  topic?: string;
  /** 토끼굴: 이어서 하고 싶은 활동 */
  followUp?: { kind: string; topic?: string };
  /** 더 할 게 없으면 계획 시간보다 일찍 끝낸다 */
  done?: boolean;
}

export interface ActionSession {
  tick(context: ActionContext, index: number): Promise<TickResult>;
  end?(context: ActionContext): Promise<void>;
}

export interface ActionModule {
  /** 고유 id. 예: "browse_news", "wiki_hole" */
  kind: string;
  /** 상태 줄에 뜨는 라벨 ("뉴스 보는 중") */
  label: Record<Language, string>;
  /** UI가 그릴 포즈/소품 id */
  sprite: string;
  /** 한 번 할 때의 시간 범위 (분) */
  minutes: [min: number, max: number];
  /** 실제로 부를 틱 수 범위. 0이면 호출 없이 연출만 한다. */
  ticks: [min: number, max: number];
  /** 0..1, 말을 걸었을 때 바로 반응할 확률 */
  interruptibility: number;
  /** 0..1, 체력 소모 */
  energyCost: number;
  /** 지금 할 수 있는가 (네트워크, 설정된 소스 등) */
  available?(context: Omit<ActionContext, "signal" | "topic">): boolean | Promise<boolean>;
  start(context: ActionContext): ActionSession | Promise<ActionSession>;
}
