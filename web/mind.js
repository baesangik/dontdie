// 관전 모드 (속마음 패널): 내부에서 일어나는 일을 전부 보여준다.
// 속마음 = 이벤트 피드, 기억 = 기억 저장소, 일기, 상태 = 기분/체력/할 말 큐/호출 수.

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clock(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ago(ms, language) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  const ko = language === "ko";
  if (minutes < 2) return ko ? "방금" : "just now";
  if (minutes < 60) return ko ? `${minutes}분 전` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ko ? `${hours}시간 전` : `${hours}h ago`;
  return ko ? `${Math.round(hours / 24)}일 전` : `${Math.round(hours / 24)}d ago`;
}

function bar(value) {
  const outer = el("span", "bar");
  const inner = el("span");
  inner.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  outer.append(inner);
  return outer;
}

/** 이벤트 하나를 피드 한 줄로. 보여줄 게 없으면 null. */
function describe(event, tr) {
  const t = tr.tags;
  switch (event.type) {
    case "thought": return { cls: "thought", tag: event.alone ? t.alone : t.thought, text: event.text };
    case "router": {
      const v = event.verdict;
      const parts = [`${v.intent} · ${Math.round(v.salience * 100)}%`];
      if (v.stakes !== "low") parts.push(`⚑ ${v.stakes}`);
      if (v.feeling) parts.push(v.feeling);
      if (v.pressure !== "none") parts.push(v.pressure);
      if (v.unknowns.length) parts.push(`? ${v.unknowns.map((u) => `${u.term}(${u.kind} ${Math.round(u.known * 100)}%)`).join(", ")}`);
      if (v.teaching.length) parts.push(`+ ${v.teaching.map((u) => u.term).join(", ")}`);
      if (v.search.requested) parts.push(`🔍 ${v.search.query ?? ""}${v.search.hint ? ` @${v.search.hint}` : ""}`);
      if (v.closure >= 0.6) parts.push(`closure ${Math.round(v.closure * 100)}%`);
      return { cls: "router", tag: event.fallback ? `${t.router} · ${t.rules}` : t.router, text: parts.join(" · "), detail: v.gist ?? undefined };
    }
    case "ladder": return { cls: "ladder", tag: t.ladder, text: event.steps.map((step) => `${step.term} → ${tr.stage[step.stage] ?? step.stage}`).join(", ") };
    case "consult": {
      if (event.state === "start") return { cls: "consult", tag: event.kind === "lookup" ? t.search : t.think, text: event.query + (event.hint ? ` @${event.hint}` : "") };
      if (event.state === "failed") return { cls: "error", tag: t.failed, text: event.code };
      const note = event.note;
      if (note.kind === "lookup") return { cls: note.found ? "learn" : "", tag: note.found ? t.found : t.notFound, text: note.found ? note.answer : note.query, links: note.sources };
      return { cls: "", tag: t.concluded, text: note.conclusion, detail: [...note.reasons, note.caution].filter(Boolean).join(" · ") || undefined };
    }
    case "memory": {
      const tag = { learned: t.learned, reinforced: t.reinforced, remembered: t.remembered, forgot: t.forgot, wondering: t.wondering }[event.op] ?? event.op;
      const cls = event.op === "forgot" ? "forget" : event.op === "learned" ? "learn" : "";
      return { cls, tag, key: event.key, text: event.op === "wondering" ? "" : event.content };
    }
    case "revise": return { cls: "", tag: t.revise, text: `${tr.revise[event.decision] ?? event.decision}: ${event.conclusion}` };
    case "speech": {
      const tag = { queued: t.queued, said: t.said, dropped: t.dropped, forgot: t.forgotSpeech }[event.op] ?? event.op;
      return { cls: event.op === "dropped" ? "dim" : "", tag, text: event.text + (event.m0 ? ` (${Math.round(event.m0 * 100)}%)` : "") };
    }
    case "assistantism": return { cls: "", tag: t.assistantism, text: `${event.hits.join(", ")} → ${tr[event.action] ?? event.action}`, detail: event.before?.join(" / ") };
    case "activity": {
      if (event.phase === "start") return { cls: "", tag: t.activity, text: `${event.label} (${event.minutes}′${event.ticks ? `, ×${event.ticks}` : ""})` };
      if (event.phase === "tick") return event.observation ? { cls: "", tag: t.activity, text: event.observation } : null;
      if (event.phase === "end") return { cls: "dim", tag: t.activity, text: `${event.summary ?? event.label} · ${tr.activityEnd[event.reason] ?? event.reason}` };
      return null;
    }
    case "sleep": return { cls: "dim", tag: t.sleep, text: event.state === "asleep" ? "zzz" : "☀" };
    case "diary": return { cls: "thought", tag: t.diary, text: event.text.split("\n")[0] };
    case "busy": return { cls: "dim", tag: t.busy, text: `${event.activity} · ${Math.round(event.ms / 1000)}s` };
    case "budget": return { cls: "error", tag: t.budget, text: `${event.layer} 0` };
    case "proactive": return { cls: "", tag: t.proactive, text: event.reason };
    case "filler": return { cls: "dim", tag: t.filler, text: event.text };
    case "attention": return { cls: "dim", tag: t.attention, text: tr.attention[event.to] ?? event.to };
    case "llm_call": return { cls: "call dim", tag: t.call, text: `${event.layer} · ${event.model} · ${(event.ms / 1000).toFixed(1)}s${event.ok ? "" : ` · ${event.code}`}` };
    case "error": return { cls: "error", tag: t.error, text: `${event.layer ?? ""} ${event.code ?? ""} ${event.message ?? ""}`.trim() };
    case "login": return { cls: "dim", tag: t.login, text: event.state + (event.detail ? ` · ${event.detail}` : event.message ? ` · ${event.message}` : "") };
    case "name_given": return { cls: "learn", tag: t.name, text: event.name };
    case "name_refused": return { cls: "", tag: t.name, text: `✕ ${event.name}` };
    case "address_set": return { cls: "learn", tag: t.name, text: `→ ${event.address}` };
    case "address_refused": return { cls: "", tag: t.name, text: `✕ ${event.address}` };
    default: return null;
  }
}

export function createMind({ tr, language, post }) {
  const drawer = $("#mind");
  const feed = $("#feed");
  let tab = "feed";
  let memoryKind = "person";

  function feedItem(event) {
    const info = describe(event, tr());
    if (!info) return;
    const item = el("li", info.cls);
    const stamp = el("time", "", clock(event.t));
    const body = el("span", "body");
    body.append(el("span", "tag", info.tag));
    if (info.key) body.append(el("span", "key", info.text ? `${info.key}: ` : info.key));
    if (info.text) body.append(document.createTextNode(info.text));
    if (info.detail) body.append(el("span", "detail", info.detail));
    if (info.links?.length) {
      const detail = el("span", "detail");
      for (const link of info.links) {
        const a = el("a", "", (() => { try { return new URL(link.url).hostname.replace(/^www\./, ""); } catch { return link.url; } })());
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        detail.append(a, document.createTextNode(" "));
      }
      body.append(detail);
    }
    item.append(stamp, body);
    const stick = feed.parentElement.scrollHeight - feed.parentElement.scrollTop - feed.parentElement.clientHeight < 60;
    feed.append(item);
    while (feed.children.length > 600) feed.firstElementChild.remove();
    if (stick) feed.parentElement.scrollTop = feed.parentElement.scrollHeight;
  }

  function reset(events) {
    feed.replaceChildren();
    for (const event of events) feedItem(event);
    feed.parentElement.scrollTop = feed.parentElement.scrollHeight;
  }

  async function renderMemory() {
    const t = tr();
    const kinds = $("#memoryKinds");
    kinds.replaceChildren(...Object.entries(t.memoryKinds).map(([kind, label]) => {
      const chip = el("button", `chip${kind === memoryKind ? " on" : ""}`, label);
      chip.type = "button";
      chip.addEventListener("click", () => { memoryKind = kind; renderMemory(); });
      return chip;
    }));
    const query = memoryKind === "forgotten" ? "forgotten=1" : `kind=${memoryKind}`;
    const { memories = [] } = await (await fetch(`/api/memory?${query}`)).json();
    const list = $("#memoryList");
    if (!memories.length) {
      list.replaceChildren(el("li", "empty", t.noMemory));
      return;
    }
    list.replaceChildren(...memories.map((memory) => {
      const item = el("li");
      if (memory.key) item.append(el("strong", "", `${memory.key} `));
      item.append(document.createTextNode(memory.kind === "question" ? memory.content : memory.content));
      const meta = el("div", "meta");
      meta.append(el("span", "", [t.source[memory.source] ?? memory.source, ago(memory.createdAt, language())].join(" · ")));
      if (memory.forgottenAt) meta.append(el("span", "", `✕ ${ago(memory.forgottenAt, language())}`));
      else meta.append(bar(memory.strength));
      item.append(meta);
      return item;
    }));
  }

  async function renderDiary() {
    const t = tr();
    const { memories = [] } = await (await fetch("/api/memory?kind=diary")).json();
    const list = $("#diaryList");
    if (!memories.length) {
      list.replaceChildren(el("p", "empty", t.noDiary));
      return;
    }
    list.replaceChildren(...memories.map((memory) => {
      const entry = el("article", "diary");
      entry.append(el("h3", "", String(memory.meta?.day ?? new Date(memory.createdAt).toLocaleDateString())), el("p", "", memory.content));
      return entry;
    }));
  }

  async function renderState() {
    const t = tr();
    const mind = await (await fetch("/api/mind")).json();
    const view = $("#stateView");
    const section = (title, ...children) => {
      const box = el("section");
      box.append(el("h3", "", title), ...children);
      return box;
    };
    const row = (label, value, text) => {
      const line = el("div", "state-row");
      line.append(el("span", "", label), bar(value), el("span", "", text));
      return line;
    };
    const mood = mind.moodValues;
    view.replaceChildren(
      section(t.state.mood,
        el("div", "", mind.mood ?? t.state.calm),
        row("valence", (mood.valence + 1) / 2, mood.valence.toFixed(2)),
        row("arousal", mood.arousal, mood.arousal.toFixed(2))),
      section(t.state.energy, row(mind.energyLabel, mind.energy, `${Math.round(mind.energy * 100)}%`)),
      section(t.state.doing, el("div", "", mind.asleep ? t.status.asleep : mind.activity?.progress ?? t.state.none)),
      section(t.state.jobs, ...(mind.jobs.length ? mind.jobs.map((job) => el("div", "", `${job.kind === "lookup" ? "🔍" : "💭"} ${job.query}`)) : [el("div", "", t.state.none)])),
      section(t.state.queue, ...(mind.queue.length ? mind.queue.map((item) => row(item.source, item.m, item.text)) : [el("div", "", t.state.none)])),
      section(t.state.usage, ...Object.entries(mind.usage).map(([layer, usage]) => row(t.layer[layer] ?? layer, usage.used / Math.max(1, usage.limit), `${usage.used}/${usage.limit}`))),
    );
  }

  function render() {
    for (const button of drawer.querySelectorAll(".tab")) button.classList.toggle("on", button.dataset.tab === tab);
    for (const pane of drawer.querySelectorAll(".pane")) pane.hidden = pane.dataset.pane !== tab;
    if (tab === "memory") renderMemory().catch(() => {});
    if (tab === "diary") renderDiary().catch(() => {});
    if (tab === "state") renderState().catch(() => {});
  }

  for (const button of drawer.querySelectorAll(".tab")) {
    button.addEventListener("click", () => { tab = button.dataset.tab; render(); });
  }
  $("#mindClose").addEventListener("click", () => close());
  $("#thoughtToggle").addEventListener("change", (event) => {
    drawer.classList.toggle("hide-thoughts", !event.target.checked);
    post("/api/config", { showThoughts: event.target.checked }).catch(() => {});
  });
  $("#callToggle").addEventListener("change", (event) => drawer.classList.toggle("hide-calls", !event.target.checked));
  drawer.classList.add("hide-calls");

  function open() { drawer.hidden = false; render(); }
  function close() { drawer.hidden = true; }
  function toggle() { if (drawer.hidden) open(); else close(); }

  /** 기억이나 상태가 바뀌는 이벤트가 오면 열려 있는 탭을 새로 그린다. */
  let refresh = 0;
  function onEvent(event) {
    feedItem(event);
    if (drawer.hidden || tab === "feed") return;
    const relevant = { memory: ["memory", "consult", "name_given"], diary: ["diary"], state: ["activity", "consult", "speech", "router", "llm_call", "sleep", "budget"] }[tab] ?? [];
    if (!relevant.includes(event.type)) return;
    clearTimeout(refresh);
    refresh = setTimeout(render, 400);
  }

  function setShowThoughts(show) {
    $("#thoughtToggle").checked = show;
    drawer.classList.toggle("hide-thoughts", !show);
  }

  return { reset, onEvent, open, close, toggle, render, setShowThoughts, get isOpen() { return !drawer.hidden; } };
}
