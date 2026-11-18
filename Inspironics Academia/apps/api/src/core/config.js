// Core settings, read from the environment on every call (so tests and operators can change them
// without re-importing the module). Defaults keep pre-R1 behaviour: Google off, internal orgs only.
const bool = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

export function coreConfig(env = process.env) {
  return {
    googleClientId: String(env.GOOGLE_CLIENT_ID || '').trim(),
    externalOrgsEnabled: bool(env.CORE_EXTERNAL_ORGS_ENABLED),
    identityKeys: env.APEX_IDENTITY_KEYS || '',
    identityIssuer: String(env.APEX_IDENTITY_ISSUER || 'apex-gateway').trim(),
    trustedSources: String(env.APEX_IDENTITY_TRUSTED_SOURCES || 'loopback'),
  };
}
