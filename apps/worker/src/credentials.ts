import { decryptByokKeys, type EncryptedByokPayload } from '@video-transcriber/shared';

const PROVIDER_KEYS = ['OPENROUTER_API_KEY', 'CANTO_GEN_API_KEY', 'SYNCLABS_API_KEY', 'FAL_KEY'] as const;

function credential(value: unknown, required: boolean): string {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('BYOK credentials are invalid');
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error('BYOK requires OpenRouter and Canto-Gen credentials');
  return trimmed;
}

export async function providerEnvironment(profile: {
  byok_enabled: boolean; encrypted_byok_keys: unknown;
}, source: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  if (!profile || typeof profile.byok_enabled !== 'boolean') {
    throw new Error('Could not verify credential mode');
  }
  if (profile.byok_enabled === true) {
    if (!profile.encrypted_byok_keys || !source.BYOK_ENCRYPTION_KEY) {
      throw new Error('BYOK credentials are missing');
    }
    const payload = profile.encrypted_byok_keys as Partial<EncryptedByokPayload>;
    if (payload.v !== 1 || typeof payload.iv !== 'string' || payload.iv.length > 32
      || typeof payload.ciphertext !== 'string' || payload.ciphertext.length > 65536) {
      throw new Error('BYOK credentials are invalid');
    }
    let keys;
    try { keys = await decryptByokKeys(payload as EncryptedByokPayload, source.BYOK_ENCRYPTION_KEY); }
    catch { throw new Error('BYOK credentials could not be decrypted'); }
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('BYOK credentials are invalid');
    return { OPENROUTER_API_KEY: credential(keys.openrouter, true),
      CANTO_GEN_API_KEY: credential(keys.cantoGen, true),
      SYNCLABS_API_KEY: credential(keys.synclabs, false), FAL_KEY: credential(keys.fal, false) };
  }
  return { OPENROUTER_API_KEY: source.OPENROUTER_API_KEY ?? '',
    CANTO_GEN_API_KEY: source.CANTO_GEN_API_KEY ?? source.CANTOGEN_API_KEY ?? '',
    SYNCLABS_API_KEY: source.SYNCLABS_API_KEY ?? source.SYNC_API_KEY ?? '', FAL_KEY: source.FAL_KEY ?? '' };
}

export function pipelineEnvironment(keys: Record<string, string>, source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { SAAS_MODE: '1', PATH: source.PATH,
    HOME: '/tmp', NODE_ENV: 'production' };
  for (const name of PROVIDER_KEYS) {
    const value = keys[name];
    if (typeof value === 'string') result[name] = value;
  }
  // Never inherit arbitrary provider aliases, database, encryption or dotenv settings.
  for (const name of ['SystemRoot', 'PYTHON', 'WHISPER_MODEL', 'SAAS_DEFAULT_REF', 'OPENROUTER_MODEL', 'CANTO_GEN_VOICE']) {
    if (source[name]) result[name] = source[name];
  }
  return result;
}
