# 아키텍처

## 1. 전체 흐름

```
 사용자 메시지 ─┐
               ▼
        [읽음 지연] ─────────── Router (무의식) 가 동시에 돈다: 판정 JSON
               │                    │  실패 → 재시도 1회 → 규칙 판정
               ▼                    ▼
        하네스: 판정 흡수  ── 기분 · 배운 것(teaching) → 기억 · 기억할 일(gist) · 주제
               │
               ├─ 모르는 것 사다리 → 단서 ("물어봐", "디시에서 찾아보래, 찾을 거면 <consult>")
               ├─ 관련 기억 검색 (꺼낸 기억은 강화)
               ├─ stakes=critical → Reasoner 숙고를 먼저 시작
               ▼
        Talker (자아) ← 존재 규칙(고정) + 대화 기록 + "[지금]" 블록
               │  비서 말투 감지 → 다시 쓰게 함 / 다듬기
               ▼
        말풍선 (사람 속도) · 표정 · 태그 처리
               │  <consult> → Reasoner 검색 (비동기, 필러)
               │  stakes=high → 반사 답을 넣고 Reasoner 숙고 (비동기)
               ▼
        Reasoner 결과 → 대화가 그 얘기 중이면 "받은 소식"으로 Talker
                      → 넘어갔으면 할 말 큐 → 쳐다볼 때 / 돌아왔을 때 꺼냄

 혼자 있을 때: 생활 스케줄러 → 활동 블록 → 드문드문 틱 → 관찰 → 속생각(Talker) → 할 말 큐
 밤: 잠 → 약한 기억 잊기, 할 말 큐 감쇠 → 일기 (Talker 1회)
```

**핵심 규칙**

- **Router**는 말하지 않는다. 판정만 한다.
- **Reasoner**도 사용자에게 직접 말하지 않는다. 말투 없는 노트만 돌려준다. Talker가 그걸 자기 말투로 바꾼다. 그래서 "GPT식 브리핑 말투"가 새어 나가지 않는다.
- **Talker**만 말한다. 언제 말할지는 하네스가 정한다(페이싱, 주의 상태, 할 말 큐).

코드: [src/harness.ts](../src/harness.ts)가 전부 묶는다. 계층과 메커니즘은 [src/mind/](../src/mind/)에 있다.

## 2. 계층별 역할

### 2.1 Router (무의식) — [src/mind/router.ts](../src/mind/router.ts)

매 사용자 메시지마다 돈다. 지시문은 [prompts/router.md](../prompts/router.md)이고, 출력은 strict JSON 스키마([src/mind/verdict.ts](../src/mind/verdict.ts))다.

```ts
interface Verdict {
  salience: number;                 // 0..1 얼마나 신경 쓸 일인가
  valence: number; arousal: number; // 감정 자극
  feeling: string | null;           // "민망", "짜증"
  intent: "chat" | "question" | "request" | "greeting" | "farewell" | "ack" | "tease" | "naming" | "teaching" | "scold" | "other";
  closure: number;                  // 0..1 대화가 끝났을 가능성
  leaving: boolean;                 // "나갔다 올게"
  stakes: "low" | "high" | "critical";
  unknowns: { term; kind: "person" | "place" | "slang" | "event" | "thing" | "other"; known: number; guess }[];
  teaching: { term; kind; fact }[]; // 이 집 사람이 알려준 사실 (사람, 단어, 취향)
  pressure: "none" | "scoff" | "insist";
  search: { requested; query; hint }; // "디시에 쳐봐" → hint: "dcinside"
  topic: string | null;
  gist: string | null;              // 기억할 만한 일 한 줄
  importance: number;
}
```

- `known`은 **모델 자신이 그 말을 얼마나 아는가**다. 진짜 모르는 것만 모른다.
- 판정은 **읽는 시간 동안** 같이 돈다. 사람도 읽으면서 이미 느낀다. ChatGPT 플랜 경로에서 Router 호출은 약 4~7초 걸린다(실측). 그중 일부가 읽음 지연과 겹친다.
- 일시적인 실패는 한 번 더 시도하고, 그래도 안 되거나 예산이 바닥나면 **규칙 판정**([src/mind/rules.ts](../src/mind/rules.ts))으로 넘어간다. 규칙은 대화 종료, 떠남, 무게, 핀잔, 검색 요청과 출처 힌트만 잡는다.

### 2.2 Talker (자아) — [src/layers/talker.ts](../src/layers/talker.ts)

본체다. 출력은 평문이고, 하네스가 태그를 읽는다.

```
<think>속생각 한 줄</think>
말풍선 1
말풍선 2
<face>embarrassed</face>        표정 (UI 스프라이트)
<name>…</name> <refuse_name>…</refuse_name> <address>…</address> <refuse_address>…</refuse_address>
<consult>검색어</consult>       찾아보기로 했다 → Reasoner 검색
<later>궁금한 것</later>        나중에 혼자 찾아볼 것 → 열린 질문
<tell>할 말</tell>              (혼자 있을 때) 나중에 할 말 → 할 말 큐
```

- 모델이 `<face=happy>`처럼 대충 써도 받아들이고, 남은 태그는 말풍선에서 지운다.
- 찾아보라고 했는데 `<consult>`를 빼먹고 "찾아볼게"라고만 했으면 하네스가 대신 검색을 시작한다.

**컨텍스트**

1. **지시문** (고정, 프롬프트 캐시를 탄다): 존재 규칙([prompts/charter.ko.md](../prompts/charter.ko.md)) + 출력 형식([prompts/format.ko.md](../prompts/format.ko.md)). 이름과 호칭이 바뀔 때만 달라진다.
2. **대화 기록**: 최근 40턴. 이전 답은 속생각을 포함한 원래 형식으로 넣는다.
3. **`[지금]` 블록** (developer 메시지, 매 턴 새로): [src/mind/context.ts](../src/mind/context.ts)

```
[지금] 2026년 10월 4일 일요일 오후 3:20 (오후). 이 집에 온 지 2일째.
[상태] 기분: 조금 민망 · 체력: 괜찮음 · 하던 것: 궁금했던 거 찾아보는 중 (3/8분)
[이 집 사람] 부르는 말: 형 · 아는 것: 이 집 사람은 매운 걸 좋아함
[떠오른 기억]
- 민수: 이 집 사람의 회사 동기. 맨날 이 집 사람 의자를 가져감 (이 집 사람이 알려줌, 3일 전)
[받은 소식]
- '킹리적갓심' 찾아봄 (디시 보라고 했음): … [확실, gall.dcinside.com]
[무의식]
- 모르는 걸로 핀잔 들었다. 좀 민망하다.
- 디시에서 '킹리적갓심' 찾아보라고 한다. 찾아볼 거면 말 끝에 <consult>킹리적갓심</consult>를 붙여.
[할 말 후보]
- 아까 블롭피시 찾아봤는데 물 밖에선 흐물흐물해진대
[지금 할 일] (먼저 말 걸기, 혼자 생각하기, 일기 같은 특별한 턴에만)
```

### 2.3 Reasoner (외장 뇌) — [src/mind/reasoner.ts](../src/mind/reasoner.ts)

- 비동기 작업이다. 지시문은 [prompts/reasoner.md](../prompts/reasoner.md)이다.
- **검색(lookup)**: 웹 검색 + effort `low`. 결과 노트는 `{ found, answer, confidence, sources }`이다. 본문에 섞인 마크다운 인용과 추적 파라미터는 걷어낸다.
- **숙고(think)**: 웹 검색 없음. effort는 기본 `medium`, 건강·돈·법·안전이면 `high`. 결과는 `{ conclusion, agreesWithReflex, reasons, caution }`이다.
- 결과 전달 ([src/harness.ts](../src/harness.ts) `#deliver`):
  - 이 집 사람이 보고 있고 그 뒤로 메시지가 2개 이하 → **받은 소식**으로 Talker에 넘긴다(대답 중이면 그 대답에 같이 실린다).
  - 그 외 → **할 말 큐**.
- 기다리는 동안: 검색이나 critical 숙고를 이 집 사람이 기다리고 있으면 12초(배속 전) 뒤에 필러를 한 번 말한다 ("잠깐만 아직 찾는 중").

## 3. 시계와 이벤트 로그

- 모든 타이머는 `Clock`을 거친다 ([src/core/clock.ts](../src/core/clock.ts)): 실시간, 배속, 수동(테스트).
- 하네스가 한 일은 전부 **추가만 하는 이벤트 로그**(`data/events.jsonl`)에 남는다. UI(SSE), 관전 모드, 테스트가 모두 이걸 본다.

| 이벤트 | 뜻 |
|---|---|
| `user_message` `seen` `typing` `say` `thinking` | 대화와 페이싱 |
| `talker_output` | Talker 한 턴 (`kind`: reply, inbox, attend, return) — 대화 기록의 원본 |
| `router` `ladder` | 무의식 판정, 사다리 단계 |
| `consult` `revise` `filler` | Reasoner 작업 (start, done, failed), 숙고 결과 처리, 필러 |
| `memory` | learned, reinforced, remembered, wondering, forgot |
| `speech` `proactive` | 할 말 큐 (queued, said, dropped, forgot), 먼저 말 걸기 |
| `face` `thought` | 표정, 속생각 |
| `assistantism` | 비서 말투 감지 (regenerate, trim) |
| `attention` `busy` | 주의 상태 전이, 바빠서 늦게 봄 |
| `activity` `sleep` `diary` | 생활 (start, tick, pause, resume, end) |
| `llm_call` `budget` `error` | 호출 기록, 예산 바닥, 오류 |

## 4. 마음 상태

| 상태 | 코드 | 저장 |
|---|---|---|
| 기분 (valence, arousal, 짧게 남는 감정 단어) | [src/mind/mood.ts](../src/mind/mood.ts) | `kv.mood` |
| 체력 = 남은 예산 × 하루 리듬 + 낮잠 보너스 | [src/mind/budget.ts](../src/mind/budget.ts) | `usage` 테이블 |
| 할 말 큐 (동기 감쇠) | [src/mind/speech.ts](../src/mind/speech.ts) | `kv.speech_queue` |
| 주의 상태 | [src/core/attention.ts](../src/core/attention.ts) | 메모리 |
| 지금 하는 활동, 잠 | [src/life/scheduler.ts](../src/life/scheduler.ts) | 메모리 (재시작하면 새로 고른다) |
| 이름, 호칭과 그 변천 | [src/character/state.ts](../src/character/state.ts) | `data/character.json` |

## 5. 주의 (attention)

```
away ⇄ around ⇄ attending (쳐다봄) → engaged (대화 중) → winding_down → around (하던 일로 복귀)
```

- 전이 판정은 하네스가 한다. LLM 호출이 없다. Router의 `closure`, `leaving`과 Talker의 질문 여부만 입력으로 쓴다.
- `attending`이 되면 할 말 큐에 동기가 높은 게 있을 때만 Talker를 부른다(먼저 말 걸기).
- `away`에서 30분 넘게 비웠다가 돌아오면 귀가 인사 턴을 연다. 그동안 한 활동은 **창을 숨긴 시각부터** 센다.
- 상세는 [MECHANISMS.md §15](MECHANISMS.md#15-주의--쳐다보기-대화-종료-부재).

## 6. 기억 — [src/memory/store.ts](../src/memory/store.ts)

SQLite(`node:sqlite`, `data/memory.sqlite`). 테이블 하나에 `kind`로 종류를 나누고, 종류마다 반감기가 다르다.

| kind | 예 | 반감기 |
|---|---|---|
| `scratch` | 방금 본 것 | 2시간 |
| `episode` | 이 집 사람이 회사를 그만둘까 고민함 | 4일 |
| `knowledge` | 킹리적갓심 = … (출처, 검색어, 알려준 사람) | 45일 |
| `person` | 민수: 회사 동기 / 의자를 가져감 | 180일 |
| `pref` | 이 집 사람은 매운 걸 좋아함 | 90일 |
| `self` | 1일차: '콩이'라는 이름을 받음 (뽀삐 거절한 뒤) | 365일 |
| `question` | 아직 모르는 것 (물어봄, 나중에, 찾는 중) | 10일 |
| `diary` | 일기 | 잊지 않음 |

- **생생함** = `중요도 × 0.5^(경과/반감기) × (1 + 0.25·ln(1+사용 횟수))`. 꺼내 쓰면 경과 시간이 0으로 돌아가고 사용 횟수가 오른다.
- **잊기**: 자기 전에 생생함이 0.04 아래인 것을 잊는다. 지우지 않고 `forgotten_at`만 찍는다. 검색에서 빠지고 관전 모드 "잊힌 것"에 남는다.
- **같은 사람/단어**는 한 줄로 합친다. 새 사실이면 " / "로 덧붙이고, 같은 사실이면 강화만 한다.
- **검색**: 임베딩 없이 글자 bigram을 쓴다. 기억 전체에서 드문 bigram일수록 무게가 크다(IDF). 그래서 "이 집 사람" 같은 흔한 말로는 안 걸린다. 이름이 언급되면 크게 가산하고, 마지막에 생생함을 곱한다.
- 같은 DB에 `topics`(주제 반복), `usage`(하루 호출 수), `kv`(작은 상태 값)도 둔다.

## 7. 생활 — [src/life/scheduler.ts](../src/life/scheduler.ts)

- 30초(배속 전)마다 점검한다.
- **잠**: `quietHours`(기본 02:00–08:00)에 대화 중이 아니면 잔다. 잠들 때 약한 기억을 잊고 할 말 큐를 감쇠시킨다. 깨면 기분이 리셋된다. 자는 중에 말을 걸면 비몽사몽 답한다.
- **일기**: 21시~02시 사이, 그날 있었던 일이 있으면 하루 한 번 쓴다 (Talker 1회).
- **활동**: 대화가 끝나고 `idleBeforeActivityMin`(3분)이 지나면 행동 모듈 중 하나를 고른다.
  - 가중치 = 모듈 기본값 × 체력 보정 × 지루함(방금 한 거면 ×0.3).
  - 고른 활동은 계획 시간 동안 틱을 드문드문(지터 포함) 부른다.
  - 대화가 시작되면 멈췄다가 끝나면 이어서 한다.
- **행동 모듈** ([src/actions/types.ts](../src/actions/types.ts)): 콘텐츠 소스도 행동이다. 소스 하나 = 모듈 하나.
  - 모듈은 하네스가 주는 `lookup()`(예산 확인, 기억 저장 포함)과 `fetchText()`(허용 목록, 아직 비어 있음)만 쓴다.
  - 지금 있는 모듈: `zone_out`(멍때리기, 호출 0회), `nap`(낮잠, 체력 회복), `look_up_question`(궁금했던 것 하나를 찾아봄).
- 틱이 관찰을 돌려주면 **혼자 생각하기** 턴(Talker)을 연다. 혼자 있을 때는 말하지 않고, `<tell>`로 할 말 큐에만 넣는다.

## 8. 예산과 체력

- 계층별 하루 호출 상한(`budget.daily`, 기본 router 800 / talker 400 / reasoner 60). 하루는 새벽 5시에 바뀐다.
- 상한은 하네스가 강제한다. 넘으면:
  - Router는 규칙 판정으로 넘어간다.
  - Reasoner는 "오늘은 머리가 안 돌아간다"고 하고, 찾던 건 열린 질문으로 남긴다.
  - Talker는 대사 없이 "zzz… 내일 얘기해"만 한다.
- ChatGPT 플랜의 앱별 상한(429)은 별도로 "아 머리아파"로 연출하고, 실제 오류는 UI에 띄운다.

## 9. Provider — [src/providers/](../src/providers/)

```ts
interface GenerateRequest {
  purpose?: "router" | "talker" | "reasoner";
  model; instructions; messages; effort?; maxOutputTokens?;
  json?: { name; schema };   // 구조화 출력
  webSearch?: boolean;       // 모델 내장 웹 검색
}
interface GenerateResult { text; citations?; webSearchUnavailable? }
```

| Provider | JSON | 웹 검색 | 비고 |
|---|---|---|---|
| ChatGPT | `text.format` json_schema | `tools: [{ type: "web_search" }]` | Sign in with ChatGPT. 플랜 경로가 기능을 거부하면 그 기능만 끄고 다시 보낸다. |
| OpenAI API | 같음 | 같음 | `OPENAI_API_KEY` |
| Anthropic | `output_config.format` | `web_search_20260209` (Haiku는 `20250305`) | 공식 SDK. `pause_turn`이면 이어서 부른다. Opus 5 계열은 server-side fallback. |
| 로컬 | `response_format` json_schema | 없음 | OpenAI 호환 |
| fake | 계층별 응답 큐 | — | 테스트와 `DONTDIE_FAKE=1` 데모 |

- **ChatGPT 공식 SDK**는 npm에 없어서 [vendor/siwc-local](../vendor/siwc-local)에 넣었다(DevKit 비상업 라이선스).
  - dontdie가 고친 건 `reasoningEffort`, `extraBody`(tools, text 등 추가 필드), 응답의 `url_citation` 수집뿐이다. 고친 파일에는 표시를 남겼다.
- 로그인 정보는 OS 키링(Linux는 Secret Service)에 둔 AES-256 키로 암호화해서 `data/chatgpt/`에 저장한다. 평문 대체는 없다.

## 10. UI (로컬 웹, 비주얼노벨)

빌드 단계 없는 정적 파일(`web/`)이다.

- **스테이지**: 방 배경(인라인 SVG, 시간대별 색) + 스프라이트 하나 + 대사창.
  - 스프라이트는 상태에 따라 바꿔 끼운다. 우선순위: 잠 → 말하는 중(표정) → 생각 중 → 검색 중 → 듣는 중 → 쳐다봄(표정) → 활동 → 졸음 → 기본.
  - 스프라이트 팩 형식은 [web/sprites/README.md](../web/sprites/README.md)에 있다. 지금은 `scripts/make-placeholder-art.mjs`가 만든 "원에 눈" 땜빵이다.
- **첫 만남**: 이벤트 CG(비 오는 밤 현관) + 나레이션 + 선택지(데려온다 / 못 본 척한다). 로그인이 안 됐으면 CG 안에서 로그인한다.
- **대사창**: 이름표, 이번 장면의 대사(타자기 효과), 내 말 + 읽음, 입력 중 표시, 입력창. 지난 대사는 **로그**(백로그)에서 본다.
- **속마음 패널**(관전 모드): 속마음(이벤트 피드) / 기억(종류별, 생생함 막대, 잊힌 것) / 일기 / 상태(기분, 체력, 하는 일, 뒤에서 하는 작업, 할 말 큐, 오늘 호출 수).
- **주의 신호**: `visibilitychange`, focus/blur, 입력창 클릭과 포커스, 타이핑(디바운스).
- 서버는 `127.0.0.1`에만 붙고, Host/Origin 검사로 다른 사이트에서 오는 요청을 막는다.

API: `GET /api/state`, `GET /api/events`(SSE), `GET /api/mind`, `GET /api/memory?kind=…|forgotten=1`, `POST /api/adopt`, `/api/message`, `/api/attention`, `/api/config`, `/api/login`, `/api/login/cancel`, `/api/logout`, `GET /api/models?provider=`.

## 11. 채널 어댑터 (M6)

웹 UI를 어댑터 중 하나로 정리하고 디스코드를 붙인다. 멘션과 DM은 `attending`, 타이핑 이벤트, 온라인/자리비움 상태를 주의 신호로 매핑한다.

## 12. 디렉터리 구조

```
dontdie/
  src/
    main.ts           # 진입점: 설정, 기억 DB, 하네스, 로컬 서버, 생활 시작
    harness.ts        # 턴 처리, 트리거(받은 소식, 먼저 말 걸기, 혼자 생각, 일기), Reasoner 작업
    config.ts         # 설정, 계층별 기본 모델, 예산, 생활
    prompts.ts        # prompts/ 읽기, [key] 템플릿
    core/             # clock, eventlog, attention, pacing
    layers/talker.ts  # Talker 지시문과 출력 파싱
    mind/             # router, rules, verdict, ladder, reasoner, context, assistantism, mood, budget, speech, lines
    memory/           # SQLite 기억 저장소, bigram 텍스트 유틸
    life/             # 생활 스케줄러 (활동, 잠, 일기)
    actions/          # 행동 모듈 인터페이스, 기본 모듈
    character/        # 이름, 호칭
    providers/        # chatgpt, openai, anthropic, local, fake, 키링 암호화
    server/           # 로컬 HTTP + SSE
  web/                # index.html, app.js, stage.js, mind.js, i18n.js, style.css, sprites/, cg/
  prompts/            # 존재 규칙, 출력 형식, Router·Reasoner 지시문
  scripts/            # try.ts (실제 모델로 대화 시험), make-placeholder-art.mjs
  vendor/siwc-local/  # Sign in with ChatGPT 로컬 SDK (비상업 라이선스)
  test/               # node:test. 수동 시계 + fake provider + 메모리 SQLite로 시나리오 검증
  docs/
```
