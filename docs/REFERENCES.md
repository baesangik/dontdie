# 참고 자료

## 설계도가 되는 논문

- **[Agents Thinking Fast and Slow: A Talker-Reasoner Architecture](https://arxiv.org/abs/2410.08328)** (Google DeepMind, 2024)
  빠른 Talker(System 1)와 느린 Reasoner(System 2). dontdie의 Talker/Reasoner 구조의 직접적인 근거다.
- **[Proactive Conversational Agents with Inner Thoughts](https://arxiv.org/abs/2501.00383)** (CHI 2025)
  겉으로 하는 대화와 별개로 속생각을 계속 만들고, 표출 동기를 점수로 매겨 말할 타이밍을 정한다. → 할 말 큐
- **[Generative Agents](https://arxiv.org/abs/2304.03442)** (Stanford, 2023)
  memory stream, reflection, 하루 계획
- **[Humanoid Agents](https://arxiv.org/abs/2310.05418)** (2023) · [code](https://github.com/HumanoidAgents/HumanoidAgents)
  기본 욕구, 감정, 관계 친밀도 → 체력, 기분, 관계 상태
- **[MemoryBank](https://arxiv.org/abs/2305.10250)** (2023) · [code](https://github.com/zhongwanjun/MemoryBank-SiliconFriend)
  에빙하우스 망각곡선 기반 기억 강화와 망각
- **[A Motivational Architecture for Conversational AGI](https://arxiv.org/abs/2606.05411)** (2026)
  대화 에이전트용 동기 항상성, 빠른 결정과 숙고의 혼합. 초록 기준 공개 코드 없음

## 오픈소스

| 프로젝트 | 참고할 점 |
|---|---|
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 음성 파이프라인, 먼저 말 걸기, Letta 기억 |
| [Project AIRI](https://github.com/moeru-ai/airi) | Neuro-sama 재현 목표, 아바타, 게임 플레이, 플러그인 |
| [Amica](https://github.com/semperai/amica) | [Amica Life](https://docs.heyamica.com/overview/amica-life): 반자율 모드, 수면, subconscious, 자기 프롬프팅 |
| [OpenClaw](https://docs.openclaw.ai/start/openclaw) | `SOUL.md`와 `HEARTBEAT.md`: 주기적으로 깨서 지금 말할 게 있는지 판단 |
| [Letta](https://docs.letta.com/guides/agents/architectures/sleeptime) | sleep-time 에이전트: 대화 사이 백그라운드에서 기억 정리 |
| [Open Souls](https://github.com/opensouls/opensouls) | mental process 상태머신, cognitive steps (legacy 릴리스) |

## 상용

- **Gatebox 3**: 집에 사는 홀로그램 캐릭터. ChatGPT, 장기기억
- **Razer Project AVA**: 책상 홀로그램 동반자. 카메라로 사용자와 화면을 봄
- Replika, Kindroid, Nomi, Grok companions: 관계와 기억은 있지만 **자기 생활이 없다**
- Neuro-sama: 가장 근접한 사례지만 비공개

## 모델 연결

- [Sign in with ChatGPT — 오픈소스 앱용 가이드](https://developers.openai.com/siwc/token-sharing-open-source)
- [Sign in with ChatGPT DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit): `@siwc/local`, `@siwc/react`. **비상업 라이선스**
- Anthropic: Free/Pro/Max 구독 OAuth를 서드파티 앱과 Agent SDK에서 쓰는 것은 허용되지 않는다. API 키를 사용한다.
