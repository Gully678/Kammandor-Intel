/**
 * KINTEL — Intelligence Dashboard route (PRD §12)
 * /dashboard
 *
 * Thin server wrapper: resolves the active brand the same way the root
 * layout does (INTEL_BRAND env, defaulting to Kammandor) and hands it to
 * the client dashboard. All data access happens client-side under the
 * signed-in user's own Supabase session — this route reads nothing itself.
 */
import type { Metadata } from 'next';
import { getBrand, resolveBrandKey } from '@/config/brands';
import DashboardClient from './DashboardClient';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Live signals, decisions waiting on you, and agent activity — at a glance.',
};

export default function DashboardPage() {
  const brandKey = resolveBrandKey(process.env.INTEL_BRAND);
  const brand = getBrand(brandKey);
  return <DashboardClient initialBrandKey={brand.key} />;
}
