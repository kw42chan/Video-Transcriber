const BASE_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR',
  'NODE_ENV', 'DOTENV_DISABLED', 'PYTHON', 'WHISPER_MODEL', 'SAAS_DEFAULT_REF',
  'REFS_DIR', 'OUT_DIR', 'CLIPS_DIR', 'OPENROUTER_MODEL', 'CANTO_GEN_VOICE',
  'SYNCLABS_BASE_URL', 'SYNCLABS_MODEL', 'SYNCLABS_USD_PER_SEC',
  'SYNCLABS_PLAN_USD', 'FAL_MUSETALK_USD_PER_SEC',
];

/** Pass runtime settings plus explicitly selected credentials to a child process. */
export function createChildEnv(sourceEnv, additions = {}) {
  const childEnv = {};
  for (const key of BASE_ENV_KEYS) {
    if (sourceEnv[key] !== undefined) childEnv[key] = sourceEnv[key];
  }
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) childEnv[key] = value;
  }
  return childEnv;
}
