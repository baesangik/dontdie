import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { emptyCharacter } from "../src/character/state.js";
import { defaultConfig, PROVIDER_DEFAULTS } from "../src/config.js";
import { RealClock } from "../src/core/clock.js";
import { EventLog } from "../src/core/eventlog.js";
import { Harness } from "../src/harness.js";
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
  harness = new Harness({ clock, log: new EventLog(null, clock), config, character: emptyCharacter(), providers: new Providers(() => config, "/nonexistent", { fake: new FakeProvider() }) });
  const server = await startServer(harness, 0);
  port = (server.address() as AddressInfo).port;
  close = () => { harness.attention.dispose(); server.close(); };
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
  assert.equal((await call("GET", "/fonts/Galmuri11.woff2")).status, 200);
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
});
