/**
 * KINTEL — Secrets Resolver
 *
 * Provides getSecret(name) with redundancy:
 *   1. process.env[name]  — works immediately on Vercel / any host with env vars
 *   2. Supabase Vault via intel_get_secret RPC  — if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *   3. undefined  — silent fallback; callers decide whether to throw
 *
 * getSecretOrThrow(name) throws a clear message when the secret is absent.
 *
 * In-memory cache (Map): each secret is fetched at most once per process.
 * NEVER log secret values.
 * Network errors from Vault never propagate — they fall through to undefined.
 *
 * Vault secret names wired for this project:
 *   BRIGHTDATA_API_KEY
 *   DATAFORSEO_LOGIN
 *   DATAFORSEO_API_KEY
 */

const cache = new Map<string, string | undefined>();

async function fetchFromVault(name: string): Promise<string | undefined> {
  const supabaseUrl     = process.env.SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return undefined;

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/intel_get_secret`, {
      method: 'POST',
      headers: {
        'apikey':         serviceRoleKey,
        'Authorization':  `Bearer ${serviceRoleKey}`,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({ p_name: name }),
    });

    if (!res.ok) {
      // Vault miss or RPC not yet applied — fall through silently
      return undefined;
    }

    const text = await res.text();
    // PostgREST returns a JSON-encoded string literal or null
    if (!text || text === 'null') return undefined;

    // Strip surrounding JSON string quotes if present
    const trimmed = text.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return JSON.parse(trimmed) as string;
    }
    return trimmed;
  } catch {
    // Network error, DNS failure, etc. — never throw from here
    return undefined;
  }
}

/**
 * Resolve a secret by name.
 * Returns the value, or undefined if not found in env or Vault.
 */
export async function getSecret(name: string): Promise<string | undefined> {
  // Return cached result (including cached undefined so Vault is hit only once)
  if (cache.has(name)) return cache.get(name);

  // Primary path: environment variable (Vercel, Docker, CI, etc.)
  const envVal = process.env[name];
  if (envVal !== undefined && envVal !== '') {
    cache.set(name, envVal);
    return envVal;
  }

  // Secondary path: Supabase Vault RPC
  const vaultVal = await fetchFromVault(name);
  cache.set(name, vaultVal);
  return vaultVal;
}

/**
 * Resolve a secret or throw a clear error message.
 * Use in adapters that cannot operate without the key.
 */
export async function getSecretOrThrow(name: string): Promise<string> {
  const value = await getSecret(name);
  if (value === undefined || value === '') {
    throw new Error(
      `${name} not configured (set env or Supabase Vault)`
    );
  }
  return value;
}
