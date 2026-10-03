// 스테이지: 스프라이트 팩을 읽고, 표정/포즈가 바뀌면 그림을 바꿔 끼운다. 배경은 시간대 색만 바꾼다.
// 스프라이트 팩: web/sprites/<팩>/manifest.json  { sprites: { neutral: "neutral.png", ... }, fallback, cg: {...} }

const FACE_TO_SPRITE = {
  neutral: "neutral", happy: "happy", sad: "sad", surprised: "surprised", embarrassed: "embarrassed",
  annoyed: "annoyed", thinking: "think", sleepy: "sleepy",
};

export function faceSprite(face) {
  return FACE_TO_SPRITE[face] ?? null;
}

export function timeOfDay(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

export function createStage({ stage, layer, a, b }) {
  let base = "";
  let manifest = null;
  let shown = null;
  let front = a;
  let back = b;
  let pending = null;

  async function loadPack(name) {
    base = `/sprites/${encodeURIComponent(name)}/`;
    try {
      manifest = await (await fetch(`${base}manifest.json`)).json();
    } catch {
      base = "/sprites/placeholder/";
      manifest = await (await fetch(`${base}manifest.json`)).json();
    }
    // 미리 받아 둔다: 바꿔 끼울 때 깜빡이지 않게
    for (const file of new Set(Object.values(manifest.sprites))) new Image().src = base + file;
    shown = null;
  }

  function fileFor(key) {
    if (!manifest) return null;
    return manifest.sprites[key] ?? manifest.sprites[manifest.fallback] ?? null;
  }

  /** 스프라이트를 바꾼다. 같은 그림이면 아무것도 안 한다. */
  function show(key) {
    const file = fileFor(key);
    if (!file || file === shown) return;
    shown = file;
    pending = file;
    back.onload = () => {
      if (pending !== file) return;
      back.classList.add("on");
      front.classList.remove("on");
      [front, back] = [back, front];
    };
    back.src = base + file;
  }

  function setVisible(visible) {
    layer.classList.toggle("hidden", !visible);
  }

  function setTalking(talking) {
    layer.classList.toggle("talking", talking);
  }

  function cgUrl(name) {
    const file = manifest?.cg?.[name];
    return file ? new URL(file, location.origin + base).pathname : `/cg/${name}.svg`;
  }

  function updateTime() {
    stage.dataset.tod = timeOfDay();
  }

  return { loadPack, show, setVisible, setTalking, cgUrl, updateTime };
}
