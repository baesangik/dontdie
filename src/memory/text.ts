// 기억 검색용 텍스트 유틸. 임베딩 없이 글자 bigram으로 비슷한 정도를 잰다.
// 한국어는 띄어쓰기와 조사가 제각각이라 단어 단위보다 글자 bigram이 잘 맞는다.

export function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function bigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalizeText(text).split(" ")) {
    const chars = [...word];
    if (chars.length === 1) grams.add(chars[0]!);
    for (let i = 0; i < chars.length - 1; i++) grams.add(chars[i]! + chars[i + 1]!);
  }
  return grams;
}

/** query의 bigram 중 몇 %가 target에 있는가 (0..1). */
export function overlap(query: Set<string>, target: Set<string>): number {
  if (query.size === 0) return 0;
  let hit = 0;
  for (const gram of query) if (target.has(gram)) hit++;
  return hit / query.size;
}

/** 텍스트에 key가 단어처럼 들어 있는가. "민수가", "민수는"처럼 조사가 붙어도 된다. */
export function mentions(text: string, key: string): boolean {
  const k = normalizeText(key);
  if (!k) return false;
  const t = normalizeText(text);
  const index = t.indexOf(k);
  if (index < 0) return false;
  // 영문/숫자 key는 앞뒤가 단어 경계여야 한다 ("art"가 "start"에 걸리지 않게).
  if (/^[a-z0-9 ]+$/.test(k)) {
    const before = t[index - 1];
    const after = t[index + k.length];
    return (!before || !/[a-z0-9]/.test(before)) && (!after || !/[a-z0-9]/.test(after));
  }
  return true;
}
