import { NextResponse } from 'next/server';

import pkg from '../../../../package.json';
import { getSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

/**
 * KINTEL v2.5 — Health / liveness surface (PRD §14/§15: observability +
 * zero-silent-failure + DR readiness)
 * GET /api/health
 *
 * Deliberately UNAUTHENTICATED: this is the surface uptime monitors and
 * the DR restore drill (docs/runbooks/OPS_DR_RUNBOOK.md) point at, so it
 * must answer before any secret is provisioned. The corollary is that it
 * must LEAK NOTHING: no secret values, no keys, no Supabase URLs, no
 * error internals — only coarse ok/degraded/configured/missing states.
 *
 * Zero-silent-failure contract:
 *  - ALWAYS 200 with an explicit body — a degraded dependency is reported
 *    as { status: 'degraded', checks: { database: 'unreachable', … } },
 *    never a 500 and never a hang (the monitor decides what to page on);
 *  - the database probe is a bounded (3s) 1-row read of intel.sources via
 *    service PostgREST — the same client pattern as /api/signals/scan;
 *  - secrets are reported as configured/missing THE WAY THE ROUTES SEE
 *    THEM: INTEL_HANDOFF_SECRET via getSecret() (env → Supabase Vault,
 *    matching /api/signals/scan), AUTOMATE_SECRET via process.env
 *    (matching /api/automate, which reads env directly).
 *
 * Response shape:
 *   {
 *     status: 'ok' | 'degraded',      // 'ok' only when every check is green
 *     version: string,                 // package.json version
 *     gitSha: string,                  // VERCEL_GIT_COMMIT_SHA → RENDER_GIT_COMMIT → 'unknown'
 *     checks: {
 *       database:       'ok' | 'unreachable',
 *       handoffSecret:  'configured' | 'missing',
 *       automateSecret: 'configured' | 'missing',
 *     },
 *     time: string,                    // ISO-8601 server time
 *   }
 */

/** Upper bound on the database probe — the liveness surface never hangs. */
const DB_PROBE_TIMEOUT_MS = 3_000;

type CheckState = 'ok' | 'unreachable';
type SecretState = 'configured' | 'missing';

interface HealthBody {
  status: 'ok' | 'degraded';
  version: string;
  gitSha: string;
  checks: {
    database: CheckState;
    handoffSecret: SecretState;
    automateSecret: SecretState;
  };
  time: string;
}

export async function GET(): Promise<NextResponse<HealthBody>> {
  const [database, handoffSecret] = await Promise.all([
    probeDatabase(),
    probeHandoffSecret(),
  ]);
  const automateSecret: SecretState = isNonEmpty(process.env.AUTOMATE_SECRET)
    ? 'configured'
    : 'missing';

  const allGreen =
    database === 'ok' &&
    handoffSecret === 'configured' &&
    automateSecret === 'configured';

  const body: HealthBody = {
    status: allGreen ? 'ok' : 'degraded',
    version: pkg.version,
    gitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.RENDER_GIT_COMMIT ??
      'unknown',
    checks: { database, handoffSecret, automateSecret },
    time: new Date().toISOString(),
  };

  // ALWAYS 200 — a degraded body is the loud signal; the monitor decides.
  return NextResponse.json(body);
}

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === 'string' && v !== '';
}

/**
 * HEAD-style 1-row read of intel.sources via service PostgREST (the
 * signals/scan client pattern), bounded to DB_PROBE_TIMEOUT_MS. Every
 * failure mode — missing config, HTTP error, network error, timeout —
 * collapses to 'unreachable'; no detail from the failure ever reaches
 * the response body.
 */
async function probeDatabase(): Promise<CheckState> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isNonEmpty(supabaseUrl) || !isNonEmpty(serviceRoleKey)) {
    return 'unreachable'; // not configured — nothing to probe, say so loudly
  }

  try {
    const url = new URL(`${supabaseUrl}/rest/v1/sources`);
    url.searchParams.set('select', 'key');
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
        'Accept-Profile': 'intel', // PostgREST: read from the `intel` schema
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(DB_PROBE_TIMEOUT_MS),
    });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable'; // network error / abort — coarse state only
  }
}

/**
 * INTEL_HANDOFF_SECRET as the tenant-handoff routes actually resolve it:
 * getSecret() (env first, then Supabase Vault). Only presence is reported.
 */
async function probeHandoffSecret(): Promise<SecretState> {
  try {
    const value = await getSecret('INTEL_HANDOFF_SECRET');
    return isNonEmpty(value) ? 'configured' : 'missing';
  } catch {
    return 'missing';
  }
}
