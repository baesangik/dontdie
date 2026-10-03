import { T } from "/i18n.js";
import { createMind } from "/mind.js";
import { createStage, faceSprite } from "/stage.js";

const $ = (selector) => document.querySelector(selector);
const PRESENT = ["attending", "engaged", "winding_down"];
const FACE_MS = 25_000;
const NEW_TURN_AFTER_MS = 60_000;

let S = null;
const ui = {
  thinking: false,
  botTyping: false,
  userTypingUntil: 0,
  attention: "around",
  face: null,
  jobs: new Map(),
  turn: { user: null, lines: [] },
  lastSayAt: 0,
  cg: null,
  error: null,
};

const tr = () => T[S?.config.language ?? "ko"];
const stage = createStage({ stage: $("#stage"), layer: $("#spriteLayer"), a: $("#spriteA"), b: $("#spriteB") });
const mind = createMind({ tr, language: () => S?.config.language ?? "ko", post });

async function post(path, body = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── 불러오기 ──

async function load() {
  const previousPack = S?.config.spritePack;
  S = await (await fetch("/api/state")).json();
  ui.attention = S.attention;
  if (S.config.spritePack !== previousPack) await stage.loadPack(S.config.spritePack);
  replay(S.events);
  mind.reset(S.events);
  mind.setShowThoughts(S.config.showThoughts);
  render();
}

/** 저장된 이벤트로 대사창 상태를 다시 만든다 (새로고침해도 이어지게). */
function replay(events) {
  ui.turn = { user: null, lines: [] };
  ui.thinking = false;
  ui.botTyping = false;
  ui.jobs.clear();
  for (const event of events) handle(event, false);
  if (!S.busy) { ui.thinking = false; ui.botTyping = false; }
  for (const job of S.mind?.jobs ?? []) ui.jobs.set(job.id, job);
}

// ── 그리기 ──

function render() {
  const t = tr();
  document.documentElement.lang = S.config.language;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const value = t[node.dataset.i18n];
    if (typeof value === "string") node.textContent = value;
  }
  const name = S.character.name ?? t.unnamed;
  $("#name").textContent = name;
  $("#plate").textContent = name;
  $("#day").textContent = S.adopted ? t.day(S.character.day) : "";
  $("#input").disabled = !S.adopted;
  $("#sendBtn").disabled = !S.adopted;
  $("#input").placeholder = S.mind?.asleep ? t.placeholderAsleep : t.placeholder;
  renderBox();
  renderNotice();
  if (!S.adopted) startCg();
  else if (ui.cg && ui.cg.state !== "adopting") endCg(false);
  stage.setVisible(S.adopted && !ui.cg);
  updatePose();
}

function renderBox(animateLast = false) {
  const t = tr();
  const you = $("#you");
  if (ui.turn.user) {
    you.hidden = false;
    you.replaceChildren(document.createTextNode(ui.turn.user.text));
    if (ui.turn.user.seen) you.append(el("span", "read", t.seen));
  } else {
    you.hidden = true;
  }
  const lines = $("#lines");
  lines.replaceChildren();
  ui.turn.lines.forEach((line, index) => {
    const node = el("p", `line${line.sys ? " sys" : ""}${index < ui.turn.lines.length - 1 && !line.sys ? " old" : ""}`);
    lines.append(node);
    if (animateLast && index === ui.turn.lines.length - 1 && !line.sys) typewrite(node, line.text);
    else node.textContent = line.text;
  });
  if (ui.botTyping) lines.append(el("p", "line typing"));
  lines.scrollTop = lines.scrollHeight;
}

let typing = 0;
function typewrite(node, text) {
  const chars = [...text];
  const step = Math.max(1, Math.ceil(chars.length / 40));
  let shown = 0;
  clearInterval(typing);
  typing = setInterval(() => {
    shown = Math.min(chars.length, shown + step);
    node.textContent = chars.slice(0, shown).join("");
    if (shown >= chars.length) clearInterval(typing);
  }, 22);
}

function renderNotice() {
  const t = tr();
  const notice = $("#notice");
  const button = $("#noticeBtn");
  const talker = S.config.layers.talker.provider;
  const status = S.providers[talker];
  notice.classList.remove("error");
  button.hidden = true;
  if (ui.error) {
    notice.hidden = false;
    notice.classList.add("error");
    $("#noticeText").textContent = ui.error;
    return;
  }
  if (S.adopted && status && !status.ready) {
    notice.hidden = false;
    $("#noticeText").textContent = S.signingIn ? t.notice.signingIn : status.detail ?? t.notice.login;
    if (talker === "chatgpt") {
      button.hidden = false;
      button.textContent = S.signingIn ? t.notice.cancel : t.notice.loginBtn;
    }
    return;
  }
  notice.hidden = true;
}

function showError(message) {
  ui.error = message;
  renderNotice();
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => { ui.error = null; if (S) renderNotice(); }, 12_000);
}

// ── 포즈와 상태 줄 ──

function present() {
  return PRESENT.includes(ui.attention);
}

function currentFace() {
  return ui.face && performance.now() - ui.face.at < FACE_MS ? faceSprite(ui.face.face) : null;
}

function computePose() {
  const mindState = S?.mind;
  const lookup = [...ui.jobs.values()].find((job) => job.kind === "lookup");
  const face = currentFace();
  if (mindState?.asleep) return { sprite: "sleep", status: "asleep" };
  if (ui.botTyping) return { sprite: face ?? "talk", status: "typing", talking: true };
  if (ui.thinking) return { sprite: "think", status: "thinking" };
  if (lookup && present()) return { sprite: "search", status: "searching", query: lookup.query };
  if (performance.now() < ui.userTypingUntil) return { sprite: "listen", status: "listening" };
  if (present()) return { sprite: face ?? "look", status: ui.jobs.size ? "pondering" : "looking" };
  const activity = mindState?.activity;
  if (lookup) return { sprite: "search", status: "searching", query: lookup.query };
  if (activity && !activity.paused) return { sprite: activity.sprite, status: "activity", text: activity.progress ?? activity.label };
  if (ui.attention === "away") return { sprite: "sleepy", status: "away" };
  return { sprite: face ?? "neutral", status: null };
}

function updatePose() {
  if (!S) return;
  const pose = computePose();
  stage.show(pose.sprite);
  stage.setTalking(Boolean(pose.talking));
  const t = tr();
  const status = $("#status");
  const text = pose.status === "activity" ? pose.text
    : pose.status === "searching" ? t.status.searching(pose.query)
    : pose.status ? t.status[pose.status] : null;
  status.hidden = !S.adopted || !text;
  status.textContent = text ?? "";
}

// ── 이벤트 ──

function newTurn(user) {
  ui.turn = { user, lines: [] };
}

function addLine(line) {
  ui.turn.lines.push(line);
  if (ui.turn.lines.length > 5) ui.turn.lines.shift();
  if (!line.sys) ui.lastSayAt = Date.now();
}

function handle(event, live) {
  const t = tr();
  switch (event.type) {
    case "adopt": addLine({ text: t.adopted, sys: true }); break;
    case "user_message": newTurn({ id: event.id, text: event.text, seen: false }); break;
    case "seen": if (ui.turn.user && ui.turn.user.id <= event.upTo) ui.turn.user.seen = true; break;
    case "thinking": ui.thinking = event.on; break;
    case "typing": ui.botTyping = event.on; break;
    case "say": {
      // 이미 대답이 끝난 장면에서 한참 뒤에 먼저 말을 걸면 새 장면으로
      const at = live ? Date.now() : event.t;
      if (ui.turn.lines.some((line) => !line.sys) && at - ui.lastSayAt > NEW_TURN_AFTER_MS) newTurn(null);
      addLine({ text: event.text });
      ui.lastSayAt = at;
      break;
    }
    case "face": ui.face = { face: event.face, at: live ? performance.now() : performance.now() - (Date.now() - event.t) }; break;
    case "consult":
      if (event.state === "start") ui.jobs.set(event.jobId, { kind: event.kind, query: event.query });
      else ui.jobs.delete(event.jobId);
      break;
    case "attention": ui.attention = event.to; break;
    case "name_given": addLine({ text: t.nameGiven(event.name), sys: true }); break;
    case "address_set": addLine({ text: t.addressSet(event.address), sys: true }); break;
    case "error": if (live && event.message) showError(event.message); break;
  }
}

let mindRefresh = 0;
function refreshMind() {
  clearTimeout(mindRefresh);
  mindRefresh = setTimeout(async () => {
    try { S.mind = await (await fetch("/api/mind")).json(); } catch { return; }
    $("#input").placeholder = S.mind.asleep ? tr().placeholderAsleep : tr().placeholder;
    updatePose();
  }, 250);
}

function connect() {
  const source = new EventSource("/api/events");
  source.onmessage = (message) => {
    const event = JSON.parse(message.data);
    if (!S) return;
    S.events.push(event);
    if (S.events.length > 1500) S.events.splice(0, S.events.length - 1000);
    if (["login", "config_change", "name_given", "address_set", "adopt"].includes(event.type)) {
      handleLogin(event);
      load();
      mind.onEvent(event);
      return;
    }
    handle(event, true);
    mind.onEvent(event);
    if (["activity", "sleep", "consult", "budget", "speech"].includes(event.type)) refreshMind();
    if (["user_message", "seen", "say", "typing", "error"].includes(event.type)) renderBox(event.type === "say");
    updatePose();
  };
}

// ── 첫 만남 CG ──

function startCg() {
  if (ui.cg) return;
  const t = tr();
  ui.cg = { state: "narration", index: 0 };
  $("#cg").hidden = false;
  $("#cgImage").src = stage.cgUrl("first_meeting");
  showCgText(t.cg.lines[0]);
}

function showCgText(text, choices = []) {
  $("#cgText").textContent = text;
  const box = $("#cgChoices");
  box.replaceChildren(...choices.map((choice) => {
    if (choice.note) return el("p", "choice-note", choice.note);
    const button = el("button", "choice", choice.label);
    button.type = "button";
    button.disabled = Boolean(choice.disabled);
    button.addEventListener("click", (event) => { event.stopPropagation(); choice.action(); });
    return button;
  }));
  $("#cgNext").hidden = choices.length > 0;
}

function advanceCg() {
  const cg = ui.cg;
  if (!cg) return;
  const t = tr();
  if (cg.state === "narration") {
    cg.index++;
    if (cg.index < t.cg.lines.length) showCgText(t.cg.lines[cg.index]);
    else {
      cg.state = "choice";
      showCgText(t.cg.lines.at(-1), [{ label: t.cg.take, action: takeIn }, { label: t.cg.ignore, action: ignore }]);
    }
  } else if (cg.state === "ignored") {
    cg.state = "choice";
    showCgText(t.cg.ignored, [{ label: t.cg.takeAfter, action: takeIn }]);
  }
}

function ignore() {
  ui.cg.state = "ignored";
  showCgText(tr().cg.ignored);
}

function takeIn() {
  const t = tr();
  const talker = S.config.layers.talker.provider;
  const status = S.providers[talker];
  if (!status?.ready) {
    ui.cg.state = "login";
    if (talker === "chatgpt") {
      showCgText(S.signingIn ? t.cg.signingIn : t.cg.needLogin, [
        S.signingIn ? { label: t.cg.cancel, action: () => toggleLogin() } : { label: t.cg.login, action: () => toggleLogin() },
      ]);
    } else {
      showCgText(t.cg.notReady(status?.detail ?? talker), [{ label: t.cg.take, action: takeIn }]);
    }
    return;
  }
  ui.cg.state = "adopting";
  showCgText(t.cg.lines.at(-1), []);
  $("#cgNext").hidden = true;
  post("/api/adopt").catch((error) => showError(error.message));
}

function endCg(flash = true) {
  if (!ui.cg) return;
  ui.cg = null;
  if (flash) {
    const node = $("#flash");
    node.classList.remove("go");
    void node.offsetWidth;
    node.classList.add("go");
    setTimeout(() => { $("#cg").hidden = true; stage.setVisible(true); }, 450);
  } else {
    $("#cg").hidden = true;
  }
}

function handleLogin(event) {
  if (event.type === "adopt" && ui.cg) {
    ui.cg.state = "adopting";
    endCg(true);
    return;
  }
  // CG에서 로그인하다가 끝났으면 바로 데려온다.
  if (event.type === "login" && ui.cg?.state === "login") {
    setTimeout(() => {
      if (!ui.cg || ui.cg.state !== "login") return;
      if (event.state === "done" && event.ready) { S.providers.chatgpt = { ready: true }; takeIn(); }
      else takeIn();
    }, 400);
  }
}

$("#cg").addEventListener("click", advanceCg);
document.addEventListener("keydown", (event) => {
  if (ui.cg && (event.key === "Enter" || event.key === " ") && document.activeElement?.tagName !== "BUTTON") {
    event.preventDefault();
    advanceCg();
  }
});

// ── 로그인 ──

async function toggleLogin() {
  try {
    if (S.signingIn) await post("/api/login/cancel");
    else await post("/api/login");
  } catch (error) { showError(error.message); }
  setTimeout(async () => { await load(); if (ui.cg?.state === "login") takeIn(); }, 300);
}
$("#noticeBtn").addEventListener("click", toggleLogin);
$("#settingsLogin").addEventListener("click", toggleLogin);
$("#settingsLogout").addEventListener("click", async () => { await post("/api/logout").catch((error) => showError(error.message)); load(); });

// ── 주의 신호 ──

let lastTypingSignal = 0;
const signal = (name) => post("/api/attention", { signal: name }).catch(() => {});
document.addEventListener("visibilitychange", () => signal(document.hidden ? "hidden" : "visible"));
window.addEventListener("focus", () => signal("focus"));
window.addEventListener("blur", () => signal("blur"));
$("#input").addEventListener("focus", () => signal("chat_focus"));
$("#input").addEventListener("pointerdown", () => signal("chat_focus"));
$("#input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.isComposing) return;
  ui.userTypingUntil = performance.now() + 3000;
  updatePose();
  setTimeout(updatePose, 3100);
  if (Date.now() - lastTypingSignal > 2000) {
    lastTypingSignal = Date.now();
    signal("typing");
  }
});

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

// ── 로그 (백로그) ──

$("#logBtn").addEventListener("click", () => {
  const t = tr();
  const list = $("#logList");
  const name = S.character.name ?? t.unnamed;
  list.replaceChildren(...S.events.flatMap((event) => {
    if (event.type === "user_message" || event.type === "say") {
      const item = el("li", event.type === "user_message" ? "me" : "bot");
      item.append(el("span", "who", event.type === "user_message" ? t.me : name), el("div", "text", event.text));
      return [item];
    }
    if (event.type === "adopt") return [el("li", "sys", t.adopted)];
    if (event.type === "name_given") return [el("li", "sys", t.nameGiven(event.name))];
    if (event.type === "address_set") return [el("li", "sys", t.addressSet(event.address))];
    return [];
  }));
  $("#log").showModal();
  list.parentElement.scrollTop = list.parentElement.scrollHeight;
});
for (const button of document.querySelectorAll("[data-close]")) button.addEventListener("click", () => button.closest("dialog").close());

$("#mindBtn").addEventListener("click", () => mind.toggle());

// ── 설정 ──

const modelCache = new Map();
async function modelsFor(provider) {
  if (!modelCache.has(provider)) {
    const result = await (await fetch(`/api/models?provider=${encodeURIComponent(provider)}`)).json();
    modelCache.set(provider, result.models ?? []);
  }
  return modelCache.get(provider);
}

function layerRow(name, layer) {
  const t = tr();
  const row = el("div", "layer-row");
  row.dataset.layer = name;
  const provider = el("select", "provider");
  for (const id of ["chatgpt", "openai", "anthropic", "local", "fake"]) provider.append(new Option(id, id, false, id === layer.provider));
  const model = el("input", "model");
  model.value = layer.model;
  model.setAttribute("list", `models-${name}`);
  const list = el("datalist");
  list.id = `models-${name}`;
  const effort = el("select", "effort");
  for (const value of ["", "none", "low", "medium", "high", "xhigh", "max"]) effort.append(new Option(value || t.effortDefault, value, false, value === (layer.effort ?? "")));
  row.append(el("strong", "", t.layer[name]), provider, model, effort, list);
  const fill = async () => list.replaceChildren(...(await modelsFor(provider.value)).map((entry) => new Option(entry.label, entry.id)));
  provider.addEventListener("change", () => {
    const defaults = S.providerDefaults[provider.value]?.[name];
    if (defaults) { model.value = defaults.model; effort.value = defaults.effort ?? ""; }
    fill();
  });
  fill();
  return row;
}

$("#settingsBtn").addEventListener("click", () => {
  const t = tr();
  const config = S.config;
  const chatgpt = S.providers.chatgpt;
  $("#accountText").textContent = chatgpt?.ready ? t.loggedIn(chatgpt.account) : chatgpt?.detail ?? t.notLoggedIn;
  $("#settingsLogout").hidden = !chatgpt?.ready;
  $("#language").value = config.language;
  $("#pace").value = config.pace;
  $("#paceValue").textContent = `×${config.pace}`;
  $("#localUrl").value = config.local.baseUrl;
  $("#lifeEnabled").checked = config.life.enabled;
  $("#quietHours").value = config.life.quietHours;
  $("#assistantism").value = config.assistantism;
  $("#budgetRouter").value = config.budget.daily.router;
  $("#budgetTalker").value = config.budget.daily.talker;
  $("#budgetReasoner").value = config.budget.daily.reasoner;
  const layers = $("#layers");
  layers.querySelectorAll(".layer-row").forEach((row) => row.remove());
  modelCache.clear();
  for (const name of ["router", "talker", "reasoner"]) layers.append(layerRow(name, config.layers[name]));
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
    await post("/api/config", {
      language: $("#language").value,
      layers,
      pace: Number($("#pace").value),
      local: { baseUrl: $("#localUrl").value },
      life: { enabled: $("#lifeEnabled").checked, quietHours: $("#quietHours").value.trim() || S.config.life.quietHours },
      assistantism: $("#assistantism").value,
      budget: { daily: { router: Number($("#budgetRouter").value), talker: Number($("#budgetTalker").value), reasoner: Number($("#budgetReasoner").value) } },
    });
  } catch (error) { showError(error.message); }
});

// ── 시작 ──

stage.updateTime();
setInterval(() => stage.updateTime(), 60_000);
await load();
connect();
setInterval(updatePose, 1000);
setInterval(refreshMind, 30_000);
