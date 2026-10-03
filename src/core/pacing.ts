// 사람 속도 페이싱. pace는 배속이다 (2면 두 배 빠름).

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 메시지를 읽는 데 걸리는 시간. */
export function readDelayMs(text: string, pace: number): number {
  return clamp(500 + [...text].length * 30, 500, 4000) / pace;
}

/** 말풍선 하나를 입력하는 데 걸리는 시간. */
export function typingDelayMs(text: string, pace: number): number {
  return clamp(400 + [...text].length * 60, 600, 6000) / pace;
}

/** 말풍선 사이의 짧은 간격. */
export function bubbleGapMs(pace: number): number {
  return 350 / pace;
}
