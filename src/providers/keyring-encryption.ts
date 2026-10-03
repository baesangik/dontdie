// Sign in with ChatGPT SDK가 요구하는 OS 기반 자격 증명 암호화.
// 무작위 AES-256 키를 OS 키링(macOS Keychain, Windows Credential Manager, Linux Secret Service)에 두고,
// 연결 정보 파일은 그 키로 AES-256-GCM 암호화한다. 평문이나 하드코딩된 키로 대체하지 않는다.

import { AsyncEntry } from "@napi-rs/keyring";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialEncryption } from "../../vendor/siwc-local/src/index.js";

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function keyringEncryption(service = "dontdie", account = "chatgpt-credential-key"): CredentialEncryption {
  // Linux에서는 Secret Service로 고정한다. 커널 keyutils로 넘어가면 재부팅 때 키가 사라진다.
  const entry = new AsyncEntry(service, account, process.platform === "linux" ? { linux: { store: "secret-service" } } : undefined);
  let cached: Buffer | undefined;

  async function key(): Promise<Buffer> {
    if (cached) return cached;
    const stored = await entry.getPassword();
    if (stored) {
      const decoded = Buffer.from(stored, "base64");
      if (decoded.length !== 32) throw new Error("OS 키링에 저장된 dontdie 키가 손상됐다.");
      cached = decoded;
      return cached;
    }
    const fresh = randomBytes(32);
    await entry.setPassword(fresh.toString("base64"));
    cached = fresh;
    return cached;
  }

  return {
    id: "dontdie-keyring-aes256gcm-v1",
    async isAvailable() {
      try {
        await key();
        return true;
      } catch {
        return false;
      }
    },
    async encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", await key(), iv);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return new Uint8Array(Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), body]));
    },
    async decrypt(ciphertext) {
      const data = Buffer.from(ciphertext);
      if (data[0] !== FORMAT_VERSION || data.length < 1 + IV_BYTES + TAG_BYTES) throw new Error("알 수 없는 자격 증명 형식이다.");
      const iv = data.subarray(1, 1 + IV_BYTES);
      const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", await key(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    },
  };
}
