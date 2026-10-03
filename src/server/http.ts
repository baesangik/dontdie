// 로컬 웹 UI 서버. 127.0.0.1에만 바인딩하고, 다른 사이트에서 오는 요청은 막는다
// (이 서버는 사용자의 ChatGPT 사용량으로 모델을 호출할 수 있기 때문이다).

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { ASSISTANTISM_MODES, LANGUAGES, LAYERS, PROVIDER_DEFAULTS, ROOT, type Config, type LayerConfig } from "../config.js";
import { dayCount } from "../character/state.js";
import type { AttentionSignal } from "../core/attention.js";
import type { Harness } from "../harness.js";
import { LINES } from "../mind/lines.js";
import { MEMORY_KINDS, strength, type MemoryKind } from "../memory/store.js";
import { PROVIDER_IDS } from "../providers/index.js";
import { asProviderError, type ProviderStatus } from "../providers/types.js";

const WEB_DIR = join(ROOT, "web");
/** UI로 보내는 이벤트. 속마음 패널(관전 모드)이 내부 메커니즘을 전부 보여준다. */
const DISPLAY_TYPES = [
  "adopt", "user_message", "seen", "thinking", "typing", "say", "thought", "attention", "face",
  "name_given", "name_refused", "address_set", "address_refused", "error", "llm_call", "login", "config_change",
  "router", "ladder", "memory", "consult", "revise", "speech", "filler", "assistantism", "activity", "sleep", "diary", "busy", "budget", "proactive",
];
const SIGNALS: AttentionSignal[] = ["visible", "hidden", "focus", "blur", "chat_focus", "typing", "sent"];
const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"];
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function startServer(harness: Harness, port: number): Promise<Server> {
  let signingIn = false;
  const allowedHosts = () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    return { hosts: [`127.0.0.1:${actual}`, `localhost:${actual}`], origins: [`http://127.0.0.1:${actual}`, `http://localhost:${actual}`] };
  };

  async function providerStatuses(): Promise<Record<string, ProviderStatus>> {
    const ids = [...new Set(LAYERS.map((layer) => harness.config.layers[layer].provider))];
    const entries = await Promise.all(ids.map(async (id) => {
      try { return [id, await harness.providers.get(id).status()] as const; }
      catch (error) { return [id, { ready: false, detail: asProviderError(error).message }] as const; }
    }));
    return Object.fromEntries(entries);
  }

  async function state() {
    const character = harness.character;
    return {
      now: harness.clock.now(),
      adopted: harness.adopted,
      character: {
        name: character.name?.value ?? null,
        addressAs: character.addressAs?.value ?? null,
        day: dayCount(character, harness.clock.now()),
      },
      config: harness.config,
      providerDefaults: PROVIDER_DEFAULTS,
      attention: harness.attention.state,
      busy: harness.busy,
      mind: mind(),
      signingIn,
      providers: await providerStatuses(),
      events: harness.log.recent(300, DISPLAY_TYPES),
    };
  }

  /** 지금 마음 상태 요약 (상태 줄, 관전 모드) */
  function mind() {
    const now = harness.clock.now();
    const language = harness.config.language;
    const current = harness.life.current;
    return {
      mood: harness.mood.describe(now, language),
      moodValues: harness.mood.current(now),
      energy: harness.budget.energy(),
      energyLabel: harness.budget.describe(language),
      asleep: harness.life.asleep,
      activity: current ? { kind: current.kind, label: current.label, sprite: current.sprite, paused: current.pausedAt !== null, endsAt: current.endsAt, progress: harness.life.describe(LINES[language].activityProgress) } : null,
      jobs: harness.jobs.map((job) => ({ id: job.id, kind: job.task.kind, query: job.task.kind === "lookup" ? job.task.query : job.task.question })),
      queue: harness.speech.top(now).slice(0, 5).map((item) => ({ text: item.text, m: Math.round(item.m * 100) / 100, source: item.source })),
      usage: Object.fromEntries(LAYERS.map((layer) => [layer, { used: harness.budget.used(layer), limit: harness.budget.limit(layer) }])),
    };
  }

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<unknown> | unknown> = {
    "GET /api/state": () => state(),
    "GET /api/events": (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write("retry: 2000\n\n");
      const unsubscribe = harness.log.subscribe((event) => {
        if (DISPLAY_TYPES.includes(event.type)) res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
      return SSE;
    },
    "POST /api/adopt": () => ({ adopted: harness.adopt() }),
    "GET /api/mind": () => mind(),
    "GET /api/memory": (_req, _res, url) => {
      const kind = url.searchParams.get("kind");
      const forgotten = url.searchParams.get("forgotten") === "1";
      if (kind && !MEMORY_KINDS.includes(kind as MemoryKind)) throw new HttpError(400, "unknown kind");
      const now = harness.clock.now();
      const memories = harness.memory.list({ ...(kind ? { kinds: [kind as MemoryKind] } : {}), ...(forgotten ? { onlyForgotten: true } : {}), limit: 300 });
      return { memories: memories.map((memory) => ({ ...memory, strength: Math.round(strength(memory, now) * 100) / 100 })) };
    },
    "POST /api/message": async (req) => {
      const body = await readJson(req) as { text?: unknown };
      if (typeof body.text !== "string" || !body.text.trim()) throw new HttpError(400, "text is required");
      if (!harness.adopted) throw new HttpError(409, "아직 집 앞에 있다. 먼저 데려와야 한다.");
      harness.userMessage(body.text);
      return { ok: true };
    },
    "POST /api/attention": async (req) => {
      const body = await readJson(req) as { signal?: unknown };
      if (!SIGNALS.includes(body.signal as AttentionSignal)) throw new HttpError(400, "unknown signal");
      harness.attentionSignal(body.signal as AttentionSignal);
      return { attention: harness.attention.state };
    },
    "GET /api/models": async (_req, _res, url) => {
      const id = url.searchParams.get("provider");
      if (!PROVIDER_IDS.includes(id as never)) throw new HttpError(400, "unknown provider");
      try {
        return { models: await harness.providers.get(id as Config["layers"]["talker"]["provider"]).listModels(AbortSignal.timeout(15_000)) };
      } catch (error) {
        return { models: [], error: asProviderError(error).toJSON() };
      }
    },
    "POST /api/config": async (req) => {
      harness.setConfig(validateConfig(harness.config, await readJson(req)));
      return { config: harness.config };
    },
    "POST /api/login": () => {
      if (signingIn) throw new HttpError(409, "이미 로그인 중이다.");
      signingIn = true;
      harness.log.append("login", { state: "started" });
      harness.providers.chatgpt().signIn()
        .then((status) => {
          harness.log.append("login", { state: "done", ready: status.ready, detail: status.detail ?? null });
          if (status.ready) harness.resume();
        })
        .catch((error) => harness.log.append("login", { state: "failed", ...asProviderError(error).toJSON() }))
        .finally(() => { signingIn = false; });
      return { started: true };
    },
    "POST /api/login/cancel": () => {
      harness.providers.chatgpt().cancelSignIn();
      return { ok: true };
    },
    "POST /api/logout": async () => {
      try { await harness.providers.chatgpt().disconnect(); }
      catch (error) { harness.log.append("error", { layer: "login", ...asProviderError(error).toJSON() }); }
      harness.log.append("login", { state: "logged_out" });
      return { ok: true };
    },
  };

  const server = createServer(async (req, res) => {
    try {
      const { hosts, origins } = allowedHosts();
      if (!hosts.includes(req.headers.host ?? "")) throw new HttpError(403, "forbidden host");
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (!origins.includes(req.headers.origin ?? "")) throw new HttpError(403, "forbidden origin");
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "json only");
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        const result = await route(req, res, url);
        if (result !== SSE) sendJson(res, 200, result);
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(url.pathname, res);
      throw new HttpError(404, "not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

const SSE = Symbol("sse");

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "invalid json"); }
}

function serveStatic(pathname: string, res: ServerResponse) {
  const base = WEB_DIR;
  let relative: string;
  try { relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)); }
  catch { throw new HttpError(400, "bad path"); }
  const file = normalize(join(base, relative));
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile() || !MIME[extname(file)]) throw new HttpError(404, "not found");
  res.writeHead(200, { "content-type": MIME[extname(file)]!, "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

/** 들어온 설정 조각을 검증해서 새 설정을 만든다. 모르는 값은 버린다. */
export function validateConfig(current: Config, input: unknown): Config {
  if (typeof input !== "object" || input === null) throw new HttpError(400, "config must be an object");
  const patch = input as Record<string, unknown>;
  const next: Config = structuredClone(current);
  if (patch.language !== undefined) {
    if (!LANGUAGES.includes(patch.language as never)) throw new HttpError(400, "unknown language");
    next.language = patch.language as Config["language"];
  }
  if (patch.layers !== undefined) {
    const layers = patch.layers as Record<string, unknown>;
    for (const name of LAYERS) {
      const layer = layers?.[name] as Partial<LayerConfig> | undefined;
      if (!layer) continue;
      if (!PROVIDER_IDS.includes(layer.provider as never)) throw new HttpError(400, `unknown provider for ${name}`);
      if (typeof layer.model !== "string" || layer.model.length > 200) throw new HttpError(400, `invalid model for ${name}`);
      if (layer.effort !== undefined && layer.effort !== "" && !EFFORTS.includes(layer.effort)) throw new HttpError(400, `invalid effort for ${name}`);
      next.layers[name] = { provider: layer.provider!, model: layer.model.trim(), ...(layer.effort ? { effort: layer.effort } : {}) };
    }
  }
  if (patch.pace !== undefined) {
    if (typeof patch.pace !== "number" || !(patch.pace >= 0.25 && patch.pace <= 20)) throw new HttpError(400, "pace must be 0.25–20");
    next.pace = patch.pace;
  }
  if (patch.showThoughts !== undefined) {
    if (typeof patch.showThoughts !== "boolean") throw new HttpError(400, "showThoughts must be boolean");
    next.showThoughts = patch.showThoughts;
  }
  if (patch.assistantism !== undefined) {
    if (!ASSISTANTISM_MODES.includes(patch.assistantism as never)) throw new HttpError(400, "invalid assistantism");
    next.assistantism = patch.assistantism as Config["assistantism"];
  }
  if (patch.life !== undefined) {
    const life = patch.life as Record<string, unknown>;
    if (typeof life !== "object" || life === null) throw new HttpError(400, "life must be an object");
    if (life.enabled !== undefined) {
      if (typeof life.enabled !== "boolean") throw new HttpError(400, "life.enabled must be boolean");
      next.life.enabled = life.enabled;
    }
    if (life.quietHours !== undefined) {
      if (typeof life.quietHours !== "string" || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(life.quietHours)) throw new HttpError(400, "quietHours must be HH:MM-HH:MM");
      next.life.quietHours = life.quietHours;
    }
  }
  if (patch.budget !== undefined) {
    const daily = (patch.budget as { daily?: Record<string, unknown> })?.daily;
    if (typeof daily !== "object" || daily === null) throw new HttpError(400, "budget.daily must be an object");
    for (const name of LAYERS) {
      const value = daily[name];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100_000) throw new HttpError(400, `invalid budget for ${name}`);
      next.budget.daily[name] = value;
    }
  }
  if (patch.spritePack !== undefined) {
    if (typeof patch.spritePack !== "string" || !/^[a-z0-9_-]{1,40}$/.test(patch.spritePack)) throw new HttpError(400, "invalid spritePack");
    next.spritePack = patch.spritePack;
  }
  if (patch.local !== undefined) {
    const baseUrl = (patch.local as { baseUrl?: unknown })?.baseUrl;
    if (typeof baseUrl !== "string" || !/^https?:\/\/[^\s]+$/.test(baseUrl)) throw new HttpError(400, "invalid local.baseUrl");
    next.local = { baseUrl };
  }
  return next;
}
