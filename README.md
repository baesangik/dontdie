# dontdie

> **코드명**입니다. 외부 공개 이름은 미정입니다. 캐릭터 이름은 **처음 데려온 사용자가 지어줍니다** (거절당할 수도 있습니다).

집 앞에 앉아 있던 LLM을 주워 와서 키우는 하네스입니다.

명령을 기다리는 챗봇이 아니라, **PC 안에서 자기 생활을 하다가 필요할 때 말을 거는 AI**를 만듭니다.

```
git clone → ChatGPT로 로그인 → 집 앞에 앉아 있던 걸 주워 옴
→ 이름 지어줌 (거절당할 수 있음) → 혼자 놀고, 모르는 건 물어보고,
  취향이 생기고, 일기 쓰고, 피곤하면 잠
```

설정은 "주워 왔다"는 것뿐입니다. 이름, 호칭, 취향, 말버릇 같은 나머지는 **상호작용하면서 배워 나갑니다.**

목표는 똑똑한 비서가 아니라 **자연스러운 생각의 과정**입니다.
모르는 단어가 나오면 바로 검색하지 않고 먼저 물어봅니다. "아니 이걸 몰라? 검색해봐" 하면 그제서야 찾아봅니다.

## 상태

**M0 (뼈대) 구현.** ChatGPT 로그인, Talker 대화, 첫 만남(이름·호칭), 주의 상태(쳐다보기 → 하던 일로), 픽셀 방 UI까지 됩니다.
Router, Reasoner, 기억, 혼자 생활하기는 다음 마일스톤입니다. → [docs/PLAN.md](docs/PLAN.md)

## 실행

Node.js 22.12 이상이 필요합니다.

```bash
git clone https://github.com/baesangik/dontdie.git
cd dontdie
npm install
npm start
```

터미널에 뜨는 주소(`http://127.0.0.1:7717`)를 브라우저로 열고 **Sign in with ChatGPT**를 누르면 됩니다.

- ChatGPT 로그인 정보는 OS 키링에 둔 키로 암호화해서 `data/`에 저장합니다. Linux는 Secret Service(gnome-keyring, KWallet)가 필요합니다.
- 실제 모델 없이 화면만 둘러보려면: `DONTDIE_FAKE=1 npm start`
- 다른 Provider: 설정에서 계층별로 고릅니다. OpenAI API는 `OPENAI_API_KEY`, Claude는 `ANTHROPIC_API_KEY` 환경 변수를 씁니다.
- 테스트: `npm test`, 타입 검사: `npm run typecheck`

## 핵심 아이디어

- **LLM 3계층**
  - **Router(무의식)**: 가장 가벼운 모델. 판정과 라우팅만 하고 말하지 않습니다.
  - **Talker(자아)**: 본체. 말투와 결정을 맡고, 모델 크기는 상관없습니다.
  - **Reasoner(외장 뇌)**: 검색과 추론을 맡습니다. 사람으로 치면 깊은 고민이나 인터넷 검색입니다.
- **사람 속도**: 생각, 검색, 활동에 모두 시간과 체력이 듭니다. 한꺼번에 다 하지 않습니다.
- **겉보기 우선**: "30분 동안 뉴스 봐야지"는 실제 호출 몇 번에 화면 연출을 더한 것입니다. 하네스가 연출하고 모델은 연기합니다.
- **주의(attention)**: 채팅창을 누르면 쳐다봅니다. 대화가 끝난 것 같고 15초 동안 말이 없으면 하던 일로 돌아갑니다.
- **기본은 침묵**: 말할 이유가 있을 때만 말합니다.
- **관전 가능**: 속마음 스트림, 일기, 관심사 변화를 전부 볼 수 있습니다.

## 범위 (v0)

텍스트만 다룹니다. 카메라, 마이크, 음성 같은 멀티모달 입력은 넣지 않습니다.
화면에는 현재 하는 일을 보여주는 이미지(스프라이트)만 띄웁니다.
대화 언어는 설정에서 고릅니다. 디스코드 채널은 v0 이후에 붙입니다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | 목표, 원칙, 범위, 마일스톤, 리스크, 미정 사항 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 3계층 구조, 이벤트 루프, 주의 상태, 기억, Provider, UI |
| [docs/MECHANISMS.md](docs/MECHANISMS.md) | "인간적으로 느껴지는" 메커니즘 목록과 시나리오 |
| [docs/REFERENCES.md](docs/REFERENCES.md) | 참고한 프로젝트, 논문, 상용 서비스 |
| [prompts/charter.ko.md](prompts/charter.ko.md) | 존재 규칙 초안 (유일한 "설정") |

## 모델

계층마다 Provider와 모델을 따로 고를 수 있습니다. 기본값은 다음과 같습니다.

| 계층 | 기본 모델 | 비고 |
|---|---|---|
| Router | `gpt-6-luna` | reasoning effort `none` |
| Talker | `gpt-6-luna` | reasoning effort `low` |
| Reasoner | `gpt-6.1-sol` | |

| Provider | 인증 | 비고 |
|---|---|---|
| ChatGPT (기본) | Sign in with ChatGPT | 사용자의 ChatGPT 플랜 사용량을 씁니다. 오픈소스/로컬 앱용 프리뷰입니다. |
| OpenAI API | API 키 | |
| Anthropic (Claude) | API 키 | Claude 구독(Pro/Max) 로그인은 서드파티 앱에서 허용되지 않아 **API 키만** 지원합니다. |
| 로컬 (OpenAI 호환) | 없음 | Ollama, llama.cpp, vLLM 등. 파인튜닝한 Talker를 쓸 때 필요합니다. |

## 라이선스

[PolyForm Noncommercial 1.0.0](LICENSE). **비상업 목적이면 자유롭게** 쓰고, 고치고, 배포할 수 있습니다. 상업적으로 쓰려면 별도로 문의해 주세요.

[vendor/siwc-local](vendor/siwc-local)은 OpenAI의 Sign-in with ChatGPT DevKit 소스이며 [자체 비상업 라이선스](vendor/siwc-local/LICENSE)를 따릅니다. UI 폰트는 [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1)입니다.

비상업 조건이 있으므로 OSI 기준의 "오픈소스"는 아니고, 소스 공개(source-available) 프로젝트입니다.
