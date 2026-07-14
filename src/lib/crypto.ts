import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * Criptografia simétrica AES-256-GCM para segredos (senhas das contas).
 *
 * A senha é cifrada no servidor antes de ir para o Firestore. A chave-mestra
 * (APP_ENCRYPTION_KEY) fica apenas na VPS — nunca no banco nem no navegador.
 * Gere uma chave com:  openssl rand -base64 32
 *
 * Formato do valor cifrado (base64): [ IV(12) | TAG(16) | CIPHERTEXT ]
 */
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "APP_ENCRYPTION_KEY ausente. Gere com: openssl rand -base64 32",
    );
  }
  // Aceita base64 ou hex; precisa resultar em exatamente 32 bytes.
  let key = Buffer.from(raw, "base64");
  if (key.length !== 32) key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      "APP_ENCRYPTION_KEY inválida: precisa de 32 bytes (base64 ou hex).",
    );
  }
  return key;
}

export const isCryptoConfigured = Boolean(process.env.APP_ENCRYPTION_KEY);

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  try {
    const key = getKey();
    const buf = Buffer.from(payload, "base64");
    if (buf.length < IV_LEN + TAG_LEN) {
      throw new Error("Dados criptografados inválidos ou corrompidos.");
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
  } catch (err) {
    throw new Error(
      `Falha na descriptografia: Chave inválida ou dados corrompidos. (${err instanceof Error ? err.message : "Erro desconhecido"})`
    );
  }
}
