import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Keyed digest for high-entropy bearer secrets (API keys). The pepper never lives in the database. */
export function keyedDigest(pepper: string, value: string): Buffer {
  return createHmac('sha256', pepper).update(value).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeEqualStrings(a: string, b: string): boolean {
  return safeEqual(Buffer.from(a), Buffer.from(b));
}

/** AES-256-GCM. `keyHex` is 64 hex chars. The auth tag is appended to the ciphertext. */
export function encryptSecret(keyHex: string, plaintext: string): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce };
}

export function decryptSecret(keyHex: string, ciphertext: Buffer, nonce: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
