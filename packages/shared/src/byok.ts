export type ByokKeySet = {
  openrouter?: string;
  cantoGen?: string;
  synclabs?: string;
  fal?: string;
};

export type EncryptedByokPayload = {
  v: 1;
  iv: string;
  ciphertext: string;
};

function b64Encode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64');
}

function b64Decode(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, 'base64');
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64Decode(base64Key);
  if (raw.length !== 32) {
    throw new Error('BYOK_ENCRYPTION_KEY must be 32 bytes (base64-encoded)');
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptByokKeys(
  keys: ByokKeySet,
  encryptionKeyBase64: string
): Promise<EncryptedByokPayload> {
  const key = await importAesKey(encryptionKeyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { v: 1, iv: b64Encode(iv), ciphertext: b64Encode(new Uint8Array(ciphertext)) };
}

export async function decryptByokKeys(
  payload: EncryptedByokPayload,
  encryptionKeyBase64: string
): Promise<ByokKeySet> {
  if (payload.v !== 1) throw new Error(`Unsupported BYOK payload version ${payload.v}`);
  const key = await importAesKey(encryptionKeyBase64);
  const iv = b64Decode(payload.iv);
  const ct = b64Decode(payload.ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as ByokKeySet;
}

/** Mask for UI — never send full secrets back to the client after save. */
export function maskByokKeys(keys: ByokKeySet): Record<string, boolean> {
  return {
    openrouter: Boolean(keys.openrouter),
    cantoGen: Boolean(keys.cantoGen),
    synclabs: Boolean(keys.synclabs),
    fal: Boolean(keys.fal),
  };
}
