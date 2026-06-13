import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// AES-256-GCM symmetric encryption for secrets stored at rest (e.g. GitHub
// OAuth tokens). Payload format: `iv:authTag:ciphertext`, all hex.
//
// ENCRYPTION_KEY may be a 64-char hex string (32 bytes) or any passphrase
// (hashed to 32 bytes with SHA-256). It MUST be set wherever secrets are
// written/read — connecting GitHub throws clearly if it is missing.

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and set it in the environment."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

/** True when a stored value is in our `iv:tag:ciphertext` hex envelope. */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a value produced by encryptSecret. Values not in the envelope
 * format are returned unchanged — back-compat for tokens stored before
 * encryption was enabled (no real data in prod yet, but safe regardless).
 */
export function decryptSecret(payload: string): string {
  if (!isEncrypted(payload)) return payload;
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
