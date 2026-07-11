import { NextRequest, NextResponse } from 'next/server';
import { getSecret } from '@/lib/secrets';
import { resolveTenantFromRequest } from '@/lib/handoff/resolveTenant';
import { isSourceEnabled } from '@/config/featureFlags';
import { resolveReviewsAdapter } from '@/lib/reviews';
import { resolveSocialAdapter, type SocialProfileType } from '@/lib/social';
import { matchSignals } from '@/lib/signals/match';
import { dedupeKey, toAlertRows } from '@/lib/signals/alerts';
import { fetchEngineWatchlist } from '@/lib/signals/engineWatchlist';
import type { SignalEvent, IntelligenceAlertRow } from '@/lib/signals/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * KINTEL — Marketing harvest (reviews + social → watchlist match → alerts).
 * POST /api/automate/marketing   (handoff-token-scoped to one tenant)
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOVERNANCE — the marketing 'listener'. For the caller's tenant,   ║
 * ║  reads the typed watchlist subjects (companies/products/people/    ║
 * ║  creators/commentators from intel.watchlist_item), pulls the       ║
 * ║  licensed reviews + social adapters FOR THOSE SUBJECTS, maps to    ║
 * ║  SignalEvents, matches them DETERMINISTICALLY against the tenant's ║
 * ║  effective watchlist, and inserts the ONLY write — rows into       ║
 * ║  public.intelligence_alerts (status='open'). No LLM severity, no   ║
 * ║  figure, no ontology write. Fully GATED: if the reviews/social     ║
 * ║  sources are not enabled or their keys are absent, it is a clean   ║
 * ║  no-op with an explanatory note — it never throws and never        ║
 * ║  fabricates. It activates the moment the licensed keys land.       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const MAX_SUBJECTS = 12;
const REVIEWS_PER = 10;
const SOCIAL_PER = 5;

interface Db { supabaseUrl: string; serviceRoleKey: string; }
function db(): Db | null {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return supabaseUrl && serviceRoleKey ? { supabaseUrl, serviceRoleKey } : null;
}
function svc(cfg: Db, write = false): Record<string, string> {
  const h: Record<string, string> = {
    apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, Accept: 'application/json',
  };
  if (write) h['Content-Type'] = 'application/json';
  return h;
}

/** Read typed subjects for a tenant, grouped for the two adapters. */
async function loadSubjects(cfg: Db, tenant: string): Promise<{ reviewSubjects: string[]; socialCompany: string[]; socialPerson: string[] }> {
  const url = new URL(`${cfg.supabaseUrl}/rest/v1/watchlist_item`);
  url.searchParams.set('tenant_id', `eq.${tenant}`);
  url.searchParams.set('active', 'eq.true');
  url.searchParams.set('select', 'kind,value');
  url.searchParams.set('kind', 'in.(company,product,person,creator,commentator)');
  const headers = { ...svc(cfg), 'Accept-Profile': 'intel' };
  const reviewSubjects: string[] = [];
  const socialCompany: string[] = [];
  const socialPerson: string[] = [];
  try {
    const res = await fetch(url.toString(), { headers, cache: 'no-store' });
    if (!res.ok) return { reviewSubjects, socialCompany, socialPerson };
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return { reviewSubjects, socialCompany, socialPerson };
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const r = row as Record<string, unknown>;
      const kind = typeof r.kind === 'string' ? r.kind : '';
      const value = typeof r.value === 'string' ? r.value.trim() : '';
      if (!value) continue;
      if (kind === 'company' || kind === 'product') reviewSubjects.push(value);
      if (kind === 'company') socialCompany.push(value);
      if (kind === 'person' || kind === 'creator' || kind === 'commentator') socialPerson.push(value);
    }
  } catch { /* degrade */ }
  return {
    reviewSubjects: [...new Set(reviewSubjects)].slice(0, MAX_SUBJECTS),
    socialCompany: [...new Set(socialCompany)].slice(0, MAX_SUBJECTS),
    socialPerson: [...new Set(socialPerson)].slice(0, MAX_SUBJECTS),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = await getSecret('INTEL_HANDOFF_SECRET');
  const tenant = resolveTenantFromRequest(req, secret);
  if (!tenant) return NextResponse.json({ error: 'No valid tenant could be resolved for this request.' }, { status: 401 });
  const cfg = db();
  if (!cfg) return NextResponse.json({ error: 'The store is not configured.' }, { status: 502 });

  const notes: string[] = [];
  const events: SignalEvent[] = [];
  const now = new Date().toISOString();
  const { reviewSubjects, socialCompany, socialPerson } = await loadSubjects(cfg, tenant);

  // ── reviews (Trustpilot/G2/Google/Yelp/App-Store/DataForSEO/BrightData) ──
  if (!isSourceEnabled('reviews')) {
    notes.push('reviews source not enabled');
  } else if (reviewSubjects.length === 0) {
    notes.push('no review subjects (add company/product items)');
  } else {
    const reviews = resolveReviewsAdapter();
    for (const subject of reviewSubjects) {
      try {
        const r = await reviews.getReviews({ entity: subject, limit: REVIEWS_PER });
        for (const rec of r.reviews ?? []) {
          events.push({
            title: `Review of ${subject} — ${rec.rating}★`,
            description: rec.text,
            url: rec.url,
            occurredAt: rec.date || now,
            sourceKey: 'reviews',
            entities: [subject],
          });
        }
      } catch (err) {
        notes.push(`reviews:${subject} — ${err instanceof Error ? err.message : 'unavailable'}`);
      }
    }
  }

  // ── social (Bright Data LinkedIn/social) ──
  if (!isSourceEnabled('social')) {
    notes.push('social source not enabled');
  } else {
    const social = resolveSocialAdapter();
    const runSocial = async (subject: string, type: SocialProfileType): Promise<void> => {
      try {
        const r = await social.getProfiles({ type, query: subject, limit: SOCIAL_PER });
        for (const p of r.profiles ?? []) {
          events.push({
            title: `Social: ${p.name}${p.headline ? ` — ${p.headline}` : ''}`,
            description: [p.headline, p.location].filter(Boolean).join(' · ') || undefined,
            url: p.url,
            occurredAt: now,
            sourceKey: 'social',
            entities: [subject],
          });
        }
      } catch (err) {
        notes.push(`social:${subject} — ${err instanceof Error ? err.message : 'unavailable'}`);
      }
    };
    for (const s of socialCompany) await runSocial(s, 'company');
    for (const s of socialPerson) await runSocial(s, 'person');
  }

  if (events.length === 0) {
    return NextResponse.json({ harvested: 0, matched: 0, inserted: 0, notes });
  }

  // deterministic match against the tenant's effective (engine) watchlist
  const watchlist = await fetchEngineWatchlist(cfg, tenant);
  const matched = matchSignals(events, watchlist);
  // in-batch dedupe (stable per event)
  const seen = new Set<string>();
  const fresh = matched.filter((m) => {
    const k = dedupeKey(tenant, m.event);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (fresh.length === 0) {
    return NextResponse.json({ harvested: events.length, matched: 0, inserted: 0, notes });
  }

  const rows: IntelligenceAlertRow[] = toAlertRows(tenant, fresh);
  try {
    const url = new URL(`${cfg.supabaseUrl}/rest/v1/intelligence_alerts`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { ...svc(cfg, true), Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ harvested: events.length, matched: fresh.length, inserted: 0, error: 'alert insert failed', notes }, { status: 502 });
  } catch {
    return NextResponse.json({ harvested: events.length, matched: fresh.length, inserted: 0, error: 'alert insert failed', notes }, { status: 502 });
  }

  return NextResponse.json({ harvested: events.length, matched: fresh.length, inserted: rows.length, notes });
}
