import { DATA_DIR, type Config, type ProviderId } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { ChatGPTProvider } from "./chatgpt.js";
import { FakeProvider } from "./fake.js";
import { LocalProvider } from "./local.js";
import { OpenAIProvider } from "./openai.js";
import type { Provider } from "./types.js";

export const PROVIDER_IDS: readonly ProviderId[] = ["chatgpt", "openai", "anthropic", "local", "fake"];

/** Provider 인스턴스를 필요할 때 만들고 재사용한다. */
export class Providers {
  #cache = new Map<string, Provider>();
  constructor(private readonly config: () => Config, private readonly dataDir = DATA_DIR, private readonly overrides: Partial<Record<ProviderId, Provider>> = {}) {}

  get(id: ProviderId): Provider {
    const override = this.overrides[id];
    if (override) return override;
    const key = id === "local" ? `local:${this.config().local.baseUrl}` : id;
    let provider = this.#cache.get(key);
    if (!provider) {
      provider = create(id, this.config(), this.dataDir);
      this.#cache.set(key, provider);
    }
    return provider;
  }

  chatgpt(): ChatGPTProvider {
    const provider = this.get("chatgpt");
    if (!(provider instanceof ChatGPTProvider)) throw new Error("ChatGPT provider is overridden");
    return provider;
  }
}

function create(id: ProviderId, config: Config, dataDir: string): Provider {
  switch (id) {
    case "chatgpt": return new ChatGPTProvider(dataDir);
    case "openai": return new OpenAIProvider();
    case "anthropic": return new AnthropicProvider();
    case "local": return new LocalProvider(config.local.baseUrl);
    case "fake": return new FakeProvider();
  }
}
