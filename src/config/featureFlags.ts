import { NextResponse } from 'next/server';

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
