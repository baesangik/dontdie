import { join } from "node:path";
import { loadCharacter, saveCharacter } from "./character/state.js";
import { DATA_DIR, loadConfig, PROVIDER_DEFAULTS, saveConfig } from "./config.js";
import { RealClock } from "./core/clock.js";
import { EventLog } from "./core/eventlog.js";
import { Harness } from "./harness.js";
import { MemoryStore } from "./memory/store.js";
import { Providers } from "./providers/index.js";
import { startServer } from "./server/http.js";

const fake = process.env.DONTDIE_FAKE === "1";
const config = loadConfig();
// DONTDIE_FAKE=1: 실제 모델 없이 UI를 둘러보는 오프라인 데모. 설정 파일은 건드리지 않는다.
if (fake) config.layers = structuredClone(PROVIDER_DEFAULTS.fake);

const clock = new RealClock();
const log = new EventLog(join(DATA_DIR, "events.jsonl"), clock);
const memory = new MemoryStore(join(DATA_DIR, "memory.sqlite"));
const providers = new Providers(() => harness.config);
const harness: Harness = new Harness({
  clock,
  log,
  providers,
  config,
  character: loadCharacter(),
  memory,
  saveCharacter: (state) => saveCharacter(state),
  saveConfig: (next) => { if (!fake) saveConfig(next); },
});

const port = Number(process.env.DONTDIE_PORT ?? config.port);
let server;
for (let attempt = 0; ; attempt++) {
  try {
    server = await startServer(harness, port + attempt);
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= 10) throw error;
  }
}

const address = server.address();
const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
log.append("app_start", { url, fake });
harness.start();
console.log(`\n  dontdie${fake ? " (fake provider)" : ""} → ${url}\n`);

const shutdown = () => {
  harness.stop();
  server.close();
  memory.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
