import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { emptyCharacter } from "../src/character/state.js";
import { defaultConfig, PROVIDER_DEFAULTS } from "../src/config.js";
import { RealClock } from "../src/core/clock.js";
import { EventLog } from "../src/core/eventlog.js";
import { Harness } from "../src/harness.js";
import { MemoryStore } from "../src/memory/store.js";
import { Providers } from "../src/providers/index.js";
import { FakeProvider } from "../src/providers/fake.js";
import { startServer, validateConfig } from "../src/server/http.js";

let port = 0;
let close: () => void;
let harness: Harness;

before(async () => {
  const config = defaultConfig();
  config.layers = structuredClone(PROVIDER_DEFAULTS.fake);
  config.pace = 20;
  const clock = new RealClock();
  harness = new Harness({ clock, log: new EventLog(null, clock), config, character: emptyCharacter(), memory: new MemoryStore(":memory:"), providers: new Providers(() => config, "/nonexistent", { fake: new FakeProvider() }) });
  const server = await startServer(harness, 0);
  port = (server.address() as AddressInfo).port;
  close = () => { harness.stop(); server.close(); };
});
after(() => close());

function call(method: string, path: string, options: { host?: string; origin?: string; body?: unknown } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request({
      host: "127.0.0.1", port, method, path,
      headers: {
        host: options.host ?? `127.0.0.1:${port}`,
        ...(options.origin ? { origin: options.origin } : {}),
        ...(payload ? { "content-type": "application/json" } : {}),
      },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

test("다른 Host로 들어온 요청은 막는다 (DNS rebinding)", async () => {
  assert.equal((await call("GET", "/api/state", { host: "evil.example:80" })).status, 403);
  assert.equal((await call("GET", "/api/state")).status, 200);
});

test("POST는 같은 출처만 받는다", async () => {
  assert.equal((await call("POST", "/api/adopt", { body: {} })).status, 403);
  assert.equal((await call("POST", "/api/adopt", { body: {}, origin: "https://evil.example" })).status, 403);
  const ok = await call("POST", "/api/adopt", { body: {}, origin: `http://127.0.0.1:${port}` });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { adopted: true });
  await harness.whenIdle();
});

test("정적 파일은 web/ 밖으로 나갈 수 없다", async () => {
  assert.equal((await call("GET", "/")).status, 200);
  assert.equal((await call("GET", "/../package.json")).status, 404);
  assert.equal((await call("GET", "/%2e%2e/package.json")).status, 404);
  assert.equal((await call("GET", "/%E0%A4%A")).status, 400, "깨진 인코딩");
});

test("기억과 마음 상태를 볼 수 있다 (관전 모드)", async () => {
  const memory = await call("GET", "/api/memory?kind=self");
  assert.equal(memory.status, 200);
  assert.ok(Array.isArray(JSON.parse(memory.body).memories));
  assert.equal((await call("GET", "/api/memory?kind=nope")).status, 400);
  const mind = JSON.parse((await call("GET", "/api/mind")).body);
  assert.ok(typeof mind.energy === "number");
  assert.ok(mind.usage.talker.limit > 0);
});

test("설정 검증", () => {
  const base = defaultConfig();
  assert.throws(() => validateConfig(base, { language: "xx" }));
  assert.throws(() => validateConfig(base, { layers: { talker: { provider: "nope", model: "x" } } }));
  assert.throws(() => validateConfig(base, { layers: { talker: { provider: "chatgpt", model: "x", effort: "turbo" } } }));
  assert.throws(() => validateConfig(base, { pace: 999 }));
  assert.throws(() => validateConfig(base, { local: { baseUrl: "javascript:alert(1)" } }));
  const next = validateConfig(base, { language: "en", layers: { talker: { provider: "anthropic", model: "claude-sonnet-5", effort: "low" } }, pace: 2 });
  assert.equal(next.language, "en");
  assert.equal(next.layers.talker.model, "claude-sonnet-5");
  assert.equal(next.layers.router.model, "gpt-6-luna", "건드리지 않은 계층은 그대로");
  assert.equal(base.language, "ko", "원본은 바뀌지 않는다");
  assert.throws(() => validateConfig(base, { assistantism: "loud" }));
  assert.throws(() => validateConfig(base, { life: { quietHours: "late" } }));
  assert.throws(() => validateConfig(base, { budget: { daily: { reasoner: -1 } } }));
  assert.throws(() => validateConfig(base, { spritePack: "../evil" }));
  const life = validateConfig(base, { life: { enabled: false, quietHours: "01:00-07:30" }, budget: { daily: { reasoner: 10 } }, assistantism: "trim" });
  assert.equal(life.life.enabled, false);
  assert.equal(life.life.quietHours, "01:00-07:30");
  assert.equal(life.budget.daily.reasoner, 10);
  assert.equal(life.budget.daily.talker, base.budget.daily.talker);
  assert.equal(life.assistantism, "trim");
});
