# 아키텍처

## 1. 전체 흐름

```
 사용자 메시지 · 주의 신호 · 시계 틱 · 활동 틱 · Reasoner 완료 · 예산 변화
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Router (무의식)       │  모든 이벤트, 가장 싼 모델 또는 규칙
                    │  salience · affect    │  절대 말하지 않음
                    │  unknowns · stakes    │
                    └──────────┬───────────┘
          wake_talker = false  │  → 하네스만 처리 (읽음 표시, 상태 갱신, 눈 움직임)
                               ▼  wake_talker = true
                    ┌──────────────────────┐
                    │  Talker (자아)         │ ← 기억 · 기분 · 체력 · 현재 활동 · inbox
                    │  말 / 속생각 / 행동     │
                    └────┬────────────┬────┘
              consult()  │            │  say · plan_activity · remember · ...
                         ▼            ▼
           ┌──────────────────┐  ┌───────────────────────────┐
           │ Reasoner (외장 뇌) │  │ Harness                    │
           │ 검색 · 추론 · 계산  │  │ 스케줄러 · 페이싱 · 예산    │
           │ 비동기, 노트만 반환 │  │ 기억 · 이벤트 로그 · UI     │
           └────────┬─────────┘  └───────────────────────────┘
                    │
                    └─ 결과 → reasoner_done 이벤트 → Router → Talker (inbox)
```

**핵심 규칙**

- **Router**는 말하지 않는다. 판정만 한다.
- **Reasoner**도 사용자에게 직접 말하지 않는다. 담백한 노트만 돌려준다. Talker가 그걸 자기 말투로 바꾼다. 그래서 "GPT식 브리핑 말투"가 새어 나가지 않는다.
- **Talker**만 말한다. 언제 말할지는 하네스가 정한다(페이싱).

## 2. 계층별 역할

### 2.1 Router (무의식)

매 이벤트마다 돈다. 가장 싸고 빨라야 한다. 출력은 고정된 JSON 스키마다.

```ts
interface RouterVerdict {
  salience: number;             // 0..1 얼마나 신경 쓸 일인가
  affect: { valence: number; arousal: number };  // 감정 자극 (delta)
  intent: "chat" | "question" | "request" | "greeting" | "farewell" | "ack" | "tease" | "naming" | "other";
  closure: number;              // 0..1 대화가 끝났을 가능성 ("ㅇㅋ", "ㄱㅅ", "잘자", 단독 "ㅋㅋ" 등)
  leaving: boolean;             // "나갔다 올게" 류 → 부재로 전환
  unknowns: string[];           // 낯선 단어 / 개인 맥락 후보
  stakes: "low" | "high" | "critical";  // 반사 답변 후 숙고가 필요한가
  needsReasoner: "no" | "maybe" | "yes";
  wakeTalker: boolean;          // false면 하네스만 처리
  topic?: string;               // 반복 감지와 관심사 갱신용 태그
}
```

- 구현체는 교체할 수 있다: 클라우드 경량 모델, 로컬 소형 모델, **규칙 기반**(테스트용, 결정적).
- `unknowns` 중 개인 맥락(사람, 장소 이름)은 LLM이 아니라 **기억 DB 조회**로 판정한다.

### 2.2 Talker (자아)

본체다. 말투, 결정, 속생각을 맡는다. 모델 크기와 무관하게 돌아가도록 컨텍스트를 짧고 구조적으로 유지한다.

**출력은 말이 아니라 행동 목록이다:**

```ts
type TalkerAction =
  | { type: "say"; bubbles: string[]; provisional?: boolean; expectsReply?: boolean }
                                                                 // provisional = 반사 답변, expectsReply = 질문을 던짐
  | { type: "think"; text: string; motivation: number }         // 속생각 → 할 말 큐
  | { type: "ask"; about: string }                               // 모르는 것 사다리: 질문
  | { type: "guess"; about: string; guess: string }              // 모르는 것 사다리: 추측
  | { type: "consult"; query: string; depth: "lookup" | "think"; reason: string; hint?: string }
  | { type: "revise"; ref: string; bubbles: string[] }           // 반사 답변 수정
  | { type: "plan_activity"; kind: ActivityKind; topic?: string; minutes: number }
  | { type: "remember"; kind: MemoryKind; content: string; importance: number }
  | { type: "accept_name"; name: string } | { type: "refuse_name"; reason: string }
  | { type: "set_address"; addressAs: string }                    // 사용자를 부르는 호칭
  | { type: "silence" };
```

**컨텍스트 조립 순서** (앞쪽은 고정해서 프롬프트 캐시를 탄다)

1. 존재 규칙 (고정)
2. 자기 기억: 지금까지 생긴 정체성, 관심사, 경험 요약
3. 이 사람과의 관계: 친밀도, 농담 허용도, 말투, 주의할 점
4. 현재 상태: 기분, 체력, 지금 하는 활동, 시간대
5. 관련 기억 (검색 결과, 상위 N개)
6. 최근 대화
7. inbox: Reasoner 결과, 할 말 큐 상위 항목
8. 이번 이벤트 + Router 판정

### 2.3 Reasoner (외장 뇌)

- Talker의 `consult`로만 호출된다. **비동기 작업**이다.
- 도구: 웹 검색, 페이지 읽기, 계산. 읽기 전용이다.
- `depth: "lookup"`은 짧은 사실 확인, `depth: "think"`는 긴 추론이다. 비용과 체력 소모가 다르다.
- 반환값은 `{ findings, confidence, sources }` 노트다. 말투가 없다.
- `hint`로 출처 힌트를 받는다. 예: 사용자가 "디시에 쳐봐"라고 했으면 검색 쿼리에 반영한다.

## 3. 이벤트 루프와 시계

```ts
interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  every(ms: number, fn: () => void): Disposable;
}
```

- 모든 타이머는 `Clock`을 거친다. **실시간 / 배속 / 수동 진행**을 지원한다. 배속 24시간을 몇 분 안에 돌릴 수 있어야 개발이 된다.
- 이벤트는 큐에 쌓이고 하나씩 처리된다. 처리 결과는 **추가만 하는 이벤트 로그**에 남는다. 리플레이, 관전 모드, 디버깅에 모두 쓴다.
- 테스트에서는 `FakeProvider`(정해진 응답)와 배속 `Clock`을 쓰고, 시나리오 단위로 검증한다.

**이벤트 종류 (v0)**

| 이벤트 | 발생 |
|---|---|
| `user_message` | 사용자 입력 |
| `attention_signal` | 채널에서 온 원시 신호: 창 보임/숨김, 포커스, 채팅창 클릭, 타이핑 |
| `attention_change` | 주의 상태 전이 (§5). `user_return`도 여기서 나온다 |
| `heartbeat` | 주기적 (예: 10~30분, 지터 포함) |
| `activity_tick` | 활동 블록 내부의 드문드문 실행 |
| `activity_end` | 활동 종료 (완료, 포기, 중단) |
| `reasoner_done` | 비동기 결과 도착 |
| `budget_change` | 예산 구간 변화, 429 등 |
| `day_phase` | 아침, 밤, 수면 시간 |

## 4. 상태

```ts
interface MindState {
  mood: { valence: number; arousal: number };  // -1..1, 0..1, 시간이 지나면 기준선으로 복귀
  energy: number;          // 0..1, 예산 잔량 × 하루 리듬
  curiosity: number;       // 0..1
  boredom: number;         // 0..1, 같은 걸 반복하면 오름
  attention: "away" | "around" | "attending" | "engaged" | "winding_down";  // §5
  activity: Activity | null;
  pendingConsults: ConsultJob[];
  speechQueue: Thought[];  // 동기 점수 순, 시간이 지나면 감쇠
  openQuestions: string[]; // 아직 못 푼 궁금증 → 자유시간 활동의 씨앗
}
```

## 5. 주의 (attention)

사용자가 지금 이쪽을 보고 있는지 단순한 상태 머신으로 추적한다. 카메라 없이 UI 신호만 쓴다.

```
away ⇄ around ⇄ attending (쳐다봄) → engaged (대화 중) → winding_down → around (하던 일로 복귀)
```

| 상태 | 뜻 |
|---|---|
| `away` | 자리에 없음. 혼자 생활하고, 할 말은 귀가할 때를 위해 쌓아둔다 |
| `around` | 창은 열려 있지만 이쪽을 안 봄. 자기 할 일을 한다 |
| `attending` | 채팅창을 누름 → 쳐다본다 |
| `engaged` | 대화 중. 활동은 멈춘다 |
| `winding_down` | 대화가 끝난 것 같음. 15초 동안 말이 없으면 하던 일로 돌아간다 |

- 전이 판정은 **하네스가 한다.** LLM 호출이 없다. Router의 `closure`와 `leaving`, Talker의 `expectsReply`만 입력으로 쓴다.
- 상세 알고리즘과 시간 값은 [MECHANISMS.md §15](MECHANISMS.md#15-주의--쳐다보기-대화-종료-부재)에 있다.

## 6. 기억

SQLite. 종류별로 테이블을 나누고 수명을 다르게 준다.

| 종류 | 테이블 | 예 | 수명 |
|---|---|---|---|
| 작업 기억 | `scratch` | 방금 읽은 기사 제목 | 분~시간, 자동 만료 |
| 에피소드 | `episodes` | 오늘 사용자가 일찍 옴 | 일~월, 감쇠 |
| 지식 | `knowledge` | 신조어 뜻 (출처, 날짜, 알려준 사람) | 길다, 확신도 있음 |
| 관계 | `people` | 이 농담 싫어함, 친밀도, **호칭과 그 변천** | 매우 길다 |
| 사용자 취향 | `prefs` | 매운 거 좋아함 (근거 횟수) | 길다, 수정 가능 |
| 자기 | `self` | 관심사 점수, 경험, 의견, **이름(지어준 사람, 날짜, 거절한 후보)** | 장기 |

**강도 = f(중요도, 반복, 최근성)**

- 꺼내 쓰면 강화된다.
- 강도가 문턱 아래로 떨어지면 **잊힌다**: 프롬프트 검색 대상에서 빠진다.
- 실제로 지우지는 않고 콜드 스토리지로 옮긴다. 관전 모드의 "잊힌 기억" 목록과 디버깅에 쓴다.

**수면 중 정리 (매일 밤)**

1. 오늘 에피소드 → 일기 (Talker가 자기 말투로 씀)
2. 강화, 약화, 망각 처리
3. 관심사 점수 갱신, 지루함 해소
4. 관계 갱신
5. 정체성 변화가 있으면 기록 ("1일차: 이름을 받음 (두 번 거절 후)", "5일차: 심해어 덕후가 됨")

## 7. 활동 시스템

혼자 하는 일은 전부 **행동 모듈**로 꽂는다. 콘텐츠 소스(뉴스, 위키, 커뮤니티 …)도 행동이다. 소스 하나 = 모듈 하나.

```ts
// src/actions/types.ts
interface ActionModule {
  kind: string;                         // "browse_news", "wiki_hole", "zone_out" …
  label: Record<Language, string>;      // 상태 줄 ("뉴스 보는 중")
  sprite: string;                       // UI 포즈/소품 id
  minutes: [min, max];                  // 한 번 할 때의 시간
  ticks: [min, max];                    // 실제 호출 틱 수. 0이면 연출만
  interruptibility: number;             // 0..1
  energyCost: number;                   // 0..1 (낮잠은 음수 = 회복)
  available?(ctx): boolean | Promise<boolean>;
  start(ctx): ActionSession;            // tick(ctx, i) → { observation?, topic?, followUp?, done? }
}
```

- 스케줄러(M3)가 활동 블록을 잡으면, 계획 시간 동안 `tick()`을 드문드문 몇 번만 부른다.
- `observation`(관찰 한 줄)이 오면 Talker가 그걸로 속생각을 만든다. 없으면 그 틱은 호출 0회다.
- 모듈은 `fetch`를 직접 쓰지 않는다. 하네스가 주는 읽기 전용 `fetchText`(허용 목록)만 쓴다.
- `ActionRegistry`에 등록한다. 지금은 `zone_out`, `nap`만 있다.

- 30분 활동이어도 틱은 4~6번뿐이다. 각 틱은 Reasoner 조회 1회 + Talker 속생각 1회 정도다.
- 틱 사이에는 스프라이트와 상태 줄만 보여준다. 예: `뉴스 보는 중 (12/30분)`.
- `zone_out`(멍때리기)과 `nap`(낮잠)은 **호출이 0회**다. 아무것도 안 하는데 살아 보이는 가장 싼 방법이다.
- 종료 방식: 완료, 포기(지루함), 토끼굴(호기심이 생겨 새 활동으로 이어짐), 중단(사용자가 옴).

자세한 내용은 [MECHANISMS.md §4](MECHANISMS.md#4-활동-블록--띄엄띄엄-수행).

## 8. 예산과 체력

- 계층별로 하루/시간당 호출 상한과 사용량 상한을 둔다. ChatGPT 플랜이면 앱별 주간 상한도 따른다.
- `energy = 예산 잔량 비율 × 하루 리듬 곡선`
- 상한 강제는 **하네스가 한다.** 모델은 체력 수치를 보고 연기만 한다.
- 실제 오류(429, 네트워크)는 UI 시스템 배지로 명확히 띄운다. 캐릭터 대사는 그 위에 덧붙이는 연출이다.

## 9. Provider

```ts
// src/providers/types.ts
interface Provider {
  id: "chatgpt" | "openai" | "anthropic" | "local" | "fake";
  status(): Promise<ProviderStatus>;
  listModels(signal?): Promise<ModelInfo[]>;
  generate(req: { model, instructions, messages, effort?, onDelta? }): Promise<{ text }>;
}
```

- **ChatGPT**: Sign in with ChatGPT, OAuth + PKCE, Responses API. `stream: true`, `store: false`만 지원하므로 **대화 상태는 전부 하네스가 관리한다**.
  - 공식 SDK `@siwc/local`은 npm에 없어서 [vendor/siwc-local](../vendor/siwc-local)에 소스를 넣었다 (DevKit 비상업 라이선스). reasoning effort를 넘기도록 두 파일만 고쳤고, 고친 파일에는 표시를 남겼다. 플랜 경로가 effort를 거부하면 그 뒤로는 빼고 보낸다.
  - 로그인 정보는 OS 키링(Linux는 Secret Service)에 둔 AES-256 키로 암호화해서 `data/chatgpt/`에 저장한다. 평문 대체는 없다.
- **fake**: 테스트와 오프라인 데모용. `DONTDIE_FAKE=1 npm start`로 실제 모델 없이 UI를 둘러볼 수 있다.
- **OpenAI API**: API 키, Responses API.
- **Anthropic**: 공식 SDK(`@anthropic-ai/sdk`), API 키. 구독 OAuth는 쓰지 않는다. Opus 5 계열은 정책상 거절될 때 서버가 다른 모델로 이어 답하도록 server-side fallback을 켠다.
- **로컬**: OpenAI 호환 엔드포인트 (Ollama, llama.cpp, vLLM).

**설정 예시 (기본값)**

```yaml
language: ko                 # 대화 언어. prompts/charter.<lang>.md 를 쓴다
layers:
  router:   { provider: chatgpt, model: gpt-6-luna,  effort: none }
  talker:   { provider: chatgpt, model: gpt-6-luna,  effort: low }
  reasoner: { provider: chatgpt, model: gpt-6.1-sol, effort: medium }   # 숙고 시 high
budget:
  daily: { router: 600, talker: 200, reasoner: 40 }   # 호출 수, 예시값
attention:                   # MECHANISMS §15
  attendIdleSec: 20
  closureIdleSec: 15
  openIdleSec: 90
  awayAfterMin: 10
  greetAfterMin: 30
pace: 1.0                    # 데모용 배속 (타이핑, 대기 시간)
quietHours: "02:00-09:00"
```

기본 모델은 설정 파일의 기본값일 뿐이다. 첫 실행 때 로그인한 계정에서 모델 목록을 조회하고, 기본 모델이 없으면 고르게 한다.

## 10. UI (v0, 로컬 웹)

빌드 단계 없는 정적 파일(`web/`)이다. 방은 캔버스에 192×120 픽셀로 직접 그린다 (`web/room.js`). 폰트는 Galmuri11.
분위기 목표는 **고능하고 엄청 발전한 다마고치**, 친구모아아파트 같은 픽셀 방이다.

포즈: `outside`(비 오는 밤 현관 앞) · `idle`(두리번, 어슬렁) · `looking`(쳐다봄, 눈이 커지고 `!`) · `listening`(사용자가 타이핑 중) · `thinking`(생각 구름) · `talking`(입 움직임) · `dozing`(사용자가 자리를 비우면 졺)

```
┌──────────────────────────────┬──────────────────────┐
│  방                            │  속마음 (관전 모드)     │
│  [ 활동 스프라이트 ]             │  12:03 router s=0.2   │
│  뉴스 보는 중 (12/30분)          │  12:03 생각: 이거 웃기네 │
│  기분 ▂▃▅  체력 ▇▇▅▂            │  12:05 consult: ...   │
├──────────────────────────────┤  12:06 할 말 큐 +1     │
│  채팅                          │                      │
│                              ├──────────────────────┤
│                              │  오늘 / 일기 / 관심사   │
└──────────────────────────────┴──────────────────────┘
```

- **방**: 현재 활동 이미지, 상태 줄, 기분과 체력
- **채팅**: 읽음 표시, 입력 중 표시, 말풍선 분할
- **속마음**: Router 판정, 속생각, Reasoner 작업, 예산. 토글할 수 있다.
- **타임라인 / 일기 / 관심사 차트 / 잊힌 기억**
- 주의 상태가 스프라이트에 반영된다: `attending`이면 쳐다보고, `winding_down`이 끝나면 하던 일로 돌아간다.

## 11. 채널 어댑터

```ts
interface Channel {
  send(bubbles: string[], opts: { typingMs: number[] }): Promise<void>;
  showActivity(sprite: string, status: string): void;
  onMessage(fn: (text: string) => void): void;
  onAttentionSignal(fn: (sig: AttentionSignal) => void): void;  // 채널마다 신호가 다르다
}
```

- v0: 로컬 웹 UI (`visibilitychange`, focus/blur, 입력창 클릭과 포커스, keydown)
- M6: 디스코드 (멘션과 DM은 `attending`, 타이핑 이벤트, 온라인/자리비움 상태). 급하지 않다.

## 12. 디렉터리 구조

```
dontdie/
  src/
    main.ts         # 진입점: 설정 로드, 하네스, 로컬 서버
    harness.ts      # 이벤트 → Talker → 페이싱 → 주의 상태
    config.ts       # 설정, 계층별 기본 모델
    core/           # clock(실시간/배속/수동), eventlog, attention, pacing
    layers/         # talker (router, reasoner는 M1)
    character/      # 캐릭터 상태 (이름, 호칭) — M2에서 기억으로
    actions/        # 행동 모듈 인터페이스와 레지스트리
    providers/      # chatgpt, openai, anthropic, local, fake, 키링 암호화
    server/         # 로컬 HTTP + SSE
  web/              # UI (index.html, app.js, room.js, style.css)
  prompts/          # 언어별 존재 규칙과 출력 형식
  vendor/siwc-local # Sign in with ChatGPT 로컬 SDK (비상업 라이선스)
  test/             # node:test, 수동 시계 + fake provider로 시나리오 검증
  docs/
```

이후 추가 예정: `memory/`(M2), `channels/`(M6), `mechanisms/`의 개별 모듈들.
