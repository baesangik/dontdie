# 스프라이트 팩

화면에는 스프라이트 하나가 서 있고, 표정과 하는 일에 따라 그림을 바꿔 끼웁니다.
지금 들어 있는 `placeholder/`는 "원에 눈 단" 땜빵입니다 (`npm run sprites`로 다시 만들 수 있습니다).

## 새 팩 만들기

1. `web/sprites/<팩 이름>/` 폴더를 만들고 그림(PNG, WebP, SVG)을 넣습니다. 팩 이름은 영문 소문자, 숫자, `-`, `_`만 씁니다.
2. 같은 폴더에 `manifest.json`을 둡니다.
3. `data/config.json`의 `spritePack`을 팩 이름으로 바꿉니다.

```json
{
  "name": "my-pack",
  "aspect": 0.77,
  "sprites": {
    "neutral": "neutral.png",
    "look": "look.png",
    "talk": "talk.png"
  },
  "fallback": "neutral",
  "cg": { "first_meeting": "first-meeting.png" }
}
```

- 그림은 아래쪽 가운데 기준으로 맞춰 세웁니다. 모든 그림의 캔버스 크기를 같게 하면 바꿔 끼울 때 흔들리지 않습니다.
- 없는 키는 `fallback` 그림을 씁니다. 처음에는 `neutral` 하나만 있어도 됩니다.
- `cg` 경로는 manifest 파일 기준 상대 경로입니다. 없으면 `web/cg/first-meeting.svg`를 씁니다.

## 키

| 키 | 언제 |
|---|---|
| `neutral` | 기본 |
| `look` | 이 집 사람이 쳐다볼 때 (채팅창을 누름, 대화 중) |
| `listen` | 이 집 사람이 입력하는 중 |
| `talk` | 말하는 중 (표정이 따로 없을 때) |
| `think` | 생각 중 (Talker 호출 중), 표정 `thinking` |
| `search` | 폰으로 찾아보는 중 (Reasoner 검색) |
| `happy` `sad` `surprised` `embarrassed` `annoyed` `sleepy` | Talker가 `<face>`로 고른 표정. 25초 동안 유지 |
| `sleep` | 자는 중, 낮잠 |
| `blank` | 멍때리는 중 |

행동 모듈(`src/actions/`)은 `sprite` 필드로 자기 그림 키를 정합니다. 새 활동을 추가하면 같은 키로 그림을 넣으면 됩니다 (예: `browse_news` → `news`).
