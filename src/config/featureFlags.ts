import { NextResponse } from 'next/server';
import { getSource } from './sources';

export const FLAGS = {
  activeReconEnabled: process.env.INTEL_ACTIVE_RECON_ENABLED === 'true', // default false
} as const;

export function guardActiveRecon() {
  if (!FLAGS.activeReconEnabled) {
    return NextResponse.json(
      { error: 'Active reconnaissance is disabled. Enable per-organisation only with an authorised-target attestation (pending compliance sign-off).' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Resolve whether a source is enabled for the current request context.
 *
 * Resolution order (first match wins):
 *  1. Tenant flags override  — if tenantFlags[key] is explicitly set, use it.
 *  2. INTEL_SOURCES env var  — if set, a source must appear in the comma list
 *                              to be enabled (acts as a platform-level allowlist).
 *  3. Registry default       — falls back to `enabledByDefault` on the SourceDef.
 *
 * The signature is designed for future DB-backed tenant flags: pass the resolved
 * Record<string,boolean> fetched from intel.tenant_source_flags for the tenant.
 */
export function isSourceEnabled(
  key: string,
  tenantFlags?: Record<string, boolean>
): boolean {
  // 1. Explicit tenant override
  if (tenantFlags && key in tenantFlags) {
    return tenantFlags[key];
  }

  // 2. Platform env allowlist
  const envList = process.env.INTEL_SOURCES;
  if (envList) {
    const allowed = envList.split(',').map(s => s.trim()).filter(Boolean);
    return allowed.includes(key);
  }

  // 3. Registry default
  const def = getSource(key);
  return def?.enabledByDefault ?? false;
}
