// prompts/ 아래 파일을 읽는다. 사용자가 고쳐 쓸 수 있도록 지시문은 코드가 아니라 파일에 둔다.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type Language } from "./config.js";

const cache = new Map<string, string>();

/** prompts/<name>.<language>.md가 있으면 그것을, 없으면 prompts/<name>.md를 읽는다. HTML 주석은 지운다. */
export function loadPrompt(name: string, language?: Language): string {
  const candidates = [...(language ? [`${name}.${language}.md`] : []), `${name}.md`];
  for (const file of candidates) {
    const path = join(ROOT, "prompts", file);
    let text = cache.get(path);
    if (text === undefined) {
      if (!existsSync(path)) continue;
      text = readFileSync(path, "utf8");
      // 개발 중에 프롬프트를 고치면 바로 반영되도록, 캐시는 DONTDIE_CACHE_PROMPTS=0이면 끈다.
      if (process.env.DONTDIE_CACHE_PROMPTS !== "0") cache.set(path, text);
    }
    return text.replace(/<!--[\s\S]*?-->/g, "").trim();
  }
  throw new Error(`prompt not found: ${name}`);
}

/** [key] / [!key] 줄 머리표와 {{key}} 치환을 처리한다. HTML 주석은 지운다. */
export function renderTemplate(template: string, values: Record<string, string | undefined>): string {
  return template
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .flatMap((line) => {
      const marker = /^\[(!?)([a-z_]+)\]\s?/.exec(line);
      if (!marker) return [line];
      const present = Boolean(values[marker[2]!]);
      if (marker[1] === "!" ? present : !present) return [];
      return [line.slice(marker[0].length)];
    })
    .join("\n")
    .replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => values[key] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
