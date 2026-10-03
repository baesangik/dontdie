import { createRoom } from "/room.js";

const T = {
  ko: {
    settings: "설정", adopt: "데려오기", send: "보내기", feed: "속마음", show: "보기", account: "ChatGPT 계정",
    logout: "로그아웃", language: "언어", models: "모델", pace: "속도", localUrl: "로컬 모델 주소", cancel: "취소", save: "저장",
    noName: "이름 없음", day: (n) => `${n}일차`, outsideDay: "집 앞",
    placeholder: "말 걸기…", placeholderOutside: "아직 집 앞에 있다",
    pose: {
      outside: "현관 앞에 쭈그려 앉아 있다", idle: "멍때리는 중", looking: "쳐다보는 중", listening: "듣는 중",
      thinking: "생각 중…", talking: "말하는 중", dozing: "꾸벅꾸벅 조는 중",
    },
    seen: "읽음", adopted: "집 안으로 데려왔다",
    nameGiven: (v) => `이름이 생겼다: ${v}`, nameRefused: (v) => `이름 거절: ${v}`,
    addressSet: (v) => `호칭: ${v}`, addressRefused: (v) => `호칭 거절: ${v}`,
    attention: {
      attending: "쳐다봄", engaged: "대화 중", winding_down: "대화가 끝난 듯", around: "하던 일로", away: "자리 비움",
    },
    returned: (min) => `돌아옴 (${min}분 만에)`,
    tags: { thought: "생각", attention: "주의", identity: "이름", error: "오류", call: "호출", login: "로그인" },
    loginNeeded: "ChatGPT로 로그인해야 깨어난다.", loggingIn: "브라우저에서 로그인하는 중… 동의를 마치면 자동으로 이어진다.",
    loginCancel: "취소", loggedIn: (who) => `연결됨${who ? `: ${who}` : ""}`, notLoggedIn: "연결 안 됨",
    connOk: "연결됨", connBad: "연결 안 됨", fake: "fake",
    layer: { router: "Router", talker: "Talker", reasoner: "Reasoner" },
    layerNote: { router: "M1부터 사용", talker: "", reasoner: "M1부터 사용" },
    effortDefault: "기본", notInList: "(목록에 없음)",
  },
  en: {
    settings: "Settings", adopt: "Bring inside", send: "Send", feed: "Inner thoughts", show: "Show", account: "ChatGPT account",
    logout: "Sign out", language: "Language", models: "Models", pace: "Pace", localUrl: "Local model URL", cancel: "Cancel", save: "Save",
    noName: "Nameless", day: (n) => `Day ${n}`, outsideDay: "Outside",
    placeholder: "Say something…", placeholderOutside: "Still outside the door",
    pose: {
      outside: "Crouching at the front door", idle: "Spacing out", looking: "Looking at you", listening: "Listening",
      thinking: "Thinking…", talking: "Talking", dozing: "Dozing off",
    },
    seen: "Read", adopted: "Brought inside",
    nameGiven: (v) => `Got a name: ${v}`, nameRefused: (v) => `Refused name: ${v}`,
    addressSet: (v) => `Calls you: ${v}`, addressRefused: (v) => `Refused to call you: ${v}`,
    attention: {
      attending: "looks at you", engaged: "talking", winding_down: "conversation winding down", around: "back to its thing", away: "you're away",
    },
    returned: (min) => `you're back (${min} min)`,
    tags: { thought: "thought", attention: "attn", identity: "name", error: "error", call: "call", login: "login" },
    loginNeeded: "Sign in with ChatGPT to wake it up.", loggingIn: "Signing in in your browser… it continues once you approve.",
    loginCancel: "Cancel", loggedIn: (who) => `Connected${who ? `: ${who}` : ""}`, notLoggedIn: "Not connected",
    connOk: "Connected", connBad: "Not connected", fake: "fake",
    layer: { router: "Router", talker: "Talker", reasoner: "Reasoner" },
    layerNote: { router: "used from M1", talker: "", reasoner: "used from M1" },
    effortDefault: "default", notInList: "(not listed)",
  },
};

const $ = (selector) => document.querySelector(selector);
const room = createRoom($("#room"));
let S = null;
const ui = { thinking: false, botTyping: false, userTypingUntil: 0, attention: "around", lastSeen: 0 };
const modelCache = new Map();

const t = () => T[S?.config.language ?? "ko"];

async function post(path, body = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

async function load() {
  S = await (await fetch("/api/state")).json();
  ui.attention = S.attention;
  ui.thinking = false;
  ui.botTyping = false;
  for (const event of S.events) {
    if (event.type === "thinking") ui.thinking = event.on;
    if (event.type === "typing") ui.botTyping = event.on;
    if (event.type === "say") ui.botTyping = false;
  }
  if (!S.busy) { ui.thinking = false; ui.botTyping = false; }
  render();
}

// ── 렌더링 ──

function render() {
  const tr = t();
  document.documentElement.lang = S.config.language;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const value = tr[element.dataset.i18n];
    if (typeof value === "string") element.textContent = value;
  }
  renderHeader();
  renderLogin();
  $("#adoptBtn").hidden = S.adopted;
  $("#adoptBtn").disabled = !S.providers[S.config.layers.talker.provider]?.ready;
  $("#input").disabled = !S.adopted;
  $("#sendBtn").disabled = !S.adopted;
  $("#input").placeholder = S.adopted ? tr.placeholder : tr.placeholderOutside;
  $("#thoughtToggle").checked = S.config.showThoughts;
  $(".side").classList.toggle("hide-thoughts", !S.config.showThoughts);

  $("#chat").replaceChildren();
  $("#feed").replaceChildren();
  for (const event of S.events) drawEvent(event, false);
  if (ui.botTyping) showTyping(true);
  updatePose();
  scrollDown();
}

function renderHeader() {
  const tr = t();
  $("#name").textContent = S.character.name ?? tr.noName;
  $("#day").textContent = S.adopted ? tr.day(S.character.day) : tr.outsideDay;
  const talker = S.config.layers.talker.provider;
  const status = S.providers[talker];
  const conn = $("#conn");
  conn.className = "chip " + (status?.ready ? "ok" : "bad");
  conn.textContent = talker === "fake" ? tr.fake : status?.ready ? `${tr.connOk} · ${S.config.layers.talker.model}` : tr.connBad;
  conn.title = status?.detail ?? "";
}

function renderLogin() {
  const tr = t();
  const talker = S.config.layers.talker.provider;
  const status = S.providers[talker];
  const needsChatGPT = Object.values(S.config.layers).some((layer) => layer.provider === "chatgpt") && !S.providers.chatgpt?.ready;
  $("#login").hidden = !needsChatGPT;
  $("#loginText").textContent = S.signingIn ? tr.loggingIn : S.providers.chatgpt?.detail ?? tr.loginNeeded;
  $("#loginBtn").textContent = S.signingIn ? tr.loginCancel : "Sign in with ChatGPT";
  const badge = $("#sysbadge");
  if (talker !== "chatgpt" && status && !status.ready) {
    badge.hidden = false;
    badge.textContent = status.detail ?? "provider not ready";
  } else if (!badge.dataset.error) {
    badge.hidden = true;
  }
}

function time(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function addMessage(side, text, id) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${side}`;
  if (id) wrap.dataset.id = id;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.append(bubble);
  $("#chat").append(wrap);
  return wrap;
}

function addSys(text) {
  const line = document.createElement("div");
  line.className = "sys";
  line.textContent = `— ${text} —`;
  $("#chat").append(line);
}

function markSeen(upTo) {
  const tr = t();
  for (const message of document.querySelectorAll(".msg.me")) {
    if (Number(message.dataset.id) <= upTo && !message.querySelector(".meta")) {
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = tr.seen;
      message.append(meta);
    }
  }
}

function showTyping(on) {
  document.querySelector(".msg.typing")?.remove();
  if (!on) return;
  const wrap = addMessage("bot", "···");
  wrap.classList.add("typing");
}

function addFeed(kind, text, at) {
  const tr = t();
  const item = document.createElement("li");
  item.className = kind;
  const stamp = document.createElement("time");
  stamp.textContent = time(at);
  const body = document.createElement("span");
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = tr.tags[kind] ?? kind;
  body.append(tag, document.createTextNode(text));
  item.append(stamp, body);
  $("#feed").append(item);
  return item;
}

function drawEvent(event, live) {
  const tr = t();
  switch (event.type) {
    case "adopt": addSys(tr.adopted); break;
    case "user_message": addMessage("me", event.text, event.id); break;
    case "seen": markSeen(event.upTo); break;
    case "thinking": ui.thinking = event.on; break;
    case "typing": ui.botTyping = event.on; if (live) showTyping(event.on); break;
    case "say":
      showTyping(false);
      addMessage("bot", event.text);
      if (live && ui.botTyping) showTyping(true);
      break;
    case "thought": addFeed("thought", event.text, event.t); break;
    case "attention": {
      ui.attention = event.to;
      const text = event.reason === "return" && event.awayMs ? tr.returned(Math.round(event.awayMs / 60000)) : tr.attention[event.to] ?? event.to;
      addFeed("attention", text, event.t);
      break;
    }
    case "name_given": addSys(tr.nameGiven(event.name)); addFeed("identity", tr.nameGiven(event.name), event.t); if (S) S.character.name = event.name; break;
    case "name_refused": addFeed("identity", tr.nameRefused(event.name), event.t); break;
    case "address_set": addFeed("identity", tr.addressSet(event.address), event.t); break;
    case "address_refused": addFeed("identity", tr.addressRefused(event.address), event.t); break;
    case "error":
      addFeed("error", `${event.code ?? ""} ${event.message ?? ""}`.trim(), event.t);
      if (live) showError(event.message ?? event.code);
      break;
    case "llm_call": addFeed("call", `${event.layer} · ${event.model} · ${(event.ms / 1000).toFixed(1)}s${event.ok ? "" : ` · ${event.code}`}`, event.t); break;
    case "login": addFeed("login", event.state + (event.detail ? ` · ${event.detail}` : event.message ? ` · ${event.message}` : ""), event.t); break;
  }
}

function showError(message) {
  const badge = $("#sysbadge");
  badge.hidden = false;
  badge.dataset.error = "1";
  badge.textContent = message;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => { delete badge.dataset.error; badge.hidden = true; if (S) renderLogin(); }, 15000);
}

function computePose() {
  if (!S?.adopted) return "outside";
  if (ui.thinking) return "thinking";
  if (ui.botTyping) return "talking";
  if (performance.now() < ui.userTypingUntil) return "listening";
  if (["attending", "engaged", "winding_down"].includes(ui.attention)) return "looking";
  if (ui.attention === "away") return "dozing";
  return "idle";
}

function updatePose() {
  const pose = computePose();
  room.setPose(pose);
  const name = S?.character.name;
  $("#status").textContent = (name && pose !== "outside" ? `${name} · ` : "") + t().pose[pose];
}

function scrollDown() {
  const chat = $("#chat");
  chat.scrollTop = chat.scrollHeight;
  const feed = $("#feed");
  feed.scrollTop = feed.scrollHeight;
}

// ── 실시간 이벤트 ──

function connect() {
  const source = new EventSource("/api/events");
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (!S) return;
    S.events.push(event);
    if (["login", "config_change", "name_given", "address_set", "adopt"].includes(event.type)) {
      load();
      return;
    }
    drawEvent(event, true);
    updatePose();
    scrollDown();
  };
  source.onerror = () => { /* EventSource가 알아서 다시 붙는다 */ };
}

// ── 주의 신호 ──

let lastTypingSignal = 0;
const signal = (name) => post("/api/attention", { signal: name }).catch(() => {});
document.addEventListener("visibilitychange", () => signal(document.hidden ? "hidden" : "visible"));
window.addEventListener("focus", () => signal("focus"));
window.addEventListener("blur", () => signal("blur"));
$("#input").addEventListener("focus", () => signal("chat_focus"));
$("#input").addEventListener("pointerdown", () => signal("chat_focus"));
$("#input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") return;
  ui.userTypingUntil = performance.now() + 3000;
  updatePose();
  setTimeout(updatePose, 3100);
  if (Date.now() - lastTypingSignal > 2000) {
    lastTypingSignal = Date.now();
    signal("typing");
  }
});

// ── 조작 ──

$("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  ui.userTypingUntil = 0;
  try { await post("/api/message", { text }); }
  catch (error) { showError(error.message); input.value = text; }
});

$("#adoptBtn").addEventListener("click", () => post("/api/adopt").catch((error) => showError(error.message)));

async function toggleLogin() {
  try {
    if (S.signingIn) await post("/api/login/cancel");
    else await post("/api/login");
  } catch (error) { showError(error.message); }
  setTimeout(load, 300);
}
$("#loginBtn").addEventListener("click", toggleLogin);
$("#settingsLogin").addEventListener("click", toggleLogin);
$("#settingsLogout").addEventListener("click", async () => { await post("/api/logout").catch((error) => showError(error.message)); load(); });

$("#thoughtToggle").addEventListener("change", async (event) => {
  await post("/api/config", { showThoughts: event.target.checked }).catch((error) => showError(error.message));
});

// ── 설정 ──

async function modelsFor(provider) {
  if (!modelCache.has(provider)) {
    const result = await (await fetch(`/api/models?provider=${encodeURIComponent(provider)}`)).json();
    modelCache.set(provider, result.models ?? []);
  }
  return modelCache.get(provider);
}

function layerRow(name, layer) {
  const tr = t();
  const row = document.createElement("div");
  row.className = "layer-row";
  row.dataset.layer = name;
  const label = document.createElement("strong");
  label.textContent = tr.layer[name];
  const provider = document.createElement("select");
  provider.className = "provider";
  for (const id of ["chatgpt", "openai", "anthropic", "local", "fake"]) provider.append(new Option(id, id, false, id === layer.provider));
  const model = document.createElement("input");
  model.className = "model";
  model.value = layer.model;
  model.setAttribute("list", `models-${name}`);
  const list = document.createElement("datalist");
  list.id = `models-${name}`;
  const effort = document.createElement("select");
  effort.className = "effort";
  for (const value of ["", "none", "low", "medium", "high", "xhigh", "max"]) effort.append(new Option(value || tr.effortDefault, value, false, value === (layer.effort ?? "")));
  row.append(label, provider, model, effort, list);
  if (tr.layerNote[name]) {
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = tr.layerNote[name];
    row.append(note);
  }
  const fillModels = async () => {
    const models = await modelsFor(provider.value);
    list.replaceChildren(...models.map((entry) => new Option(entry.label, entry.id)));
  };
  provider.addEventListener("change", () => {
    const defaults = S.providerDefaults[provider.value]?.[name];
    if (defaults) { model.value = defaults.model; effort.value = defaults.effort ?? ""; }
    fillModels();
  });
  fillModels();
  return row;
}

$("#settingsBtn").addEventListener("click", () => {
  const tr = t();
  const chatgpt = S.providers.chatgpt;
  $("#accountText").textContent = chatgpt?.ready ? tr.loggedIn(chatgpt.account) : chatgpt?.detail ?? tr.notLoggedIn;
  $("#settingsLogout").hidden = !chatgpt?.ready;
  $("#language").value = S.config.language;
  $("#pace").value = S.config.pace;
  $("#paceValue").textContent = `×${S.config.pace}`;
  $("#localUrl").value = S.config.local.baseUrl;
  const layers = $("#layers");
  layers.querySelectorAll(".layer-row").forEach((row) => row.remove());
  modelCache.clear();
  for (const name of ["router", "talker", "reasoner"]) layers.append(layerRow(name, S.config.layers[name]));
  $("#settings").showModal();
});
$("#pace").addEventListener("input", (event) => { $("#paceValue").textContent = `×${event.target.value}`; });

$("#settings").addEventListener("close", async () => {
  if ($("#settings").returnValue !== "save") return;
  const layers = {};
  for (const row of document.querySelectorAll(".layer-row")) {
    const effort = row.querySelector(".effort").value;
    layers[row.dataset.layer] = { provider: row.querySelector(".provider").value, model: row.querySelector(".model").value, ...(effort ? { effort } : {}) };
  }
  try {
    await post("/api/config", { language: $("#language").value, layers, pace: Number($("#pace").value), local: { baseUrl: $("#localUrl").value } });
  } catch (error) { showError(error.message); }
});

await load();
connect();
setInterval(updatePose, 1000);
