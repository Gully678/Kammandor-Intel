/**
 * KINTEL — DataForSEO SERP Adapter (v3, Live/Advanced — verified against docs).
 *
 * Verified endpoints (https://docs.dataforseo.com/v3/serp/):
 *   POST https://api.dataforseo.com/v3/serp/google/news/live/advanced
 *   POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced
 *
 * The LIVE method returns results INLINE (no task_post/task_get polling):
 *   Auth:  Basic base64(DATAFORSEO_LOGIN:DATAFORSEO_API_KEY)
 *   Body:  [{ keyword, location_code, language_code, depth, device, os }]
 *   Resp:  { status_code, tasks:[{ status_code, result:[{ items:[ … ] }] }] }
 *
 * NEWS item types (verified from the example response):
 *   • type "news_search"  — { rank_group, rank_absolute, domain, title, url,
 *                             snippet, source?, timestamp }
 *   • type "top_stories"  — { items:[{ type:"top_stories_element", source,
 *                             domain, title, date, timestamp, url }] }  (flattened)
 * ORGANIC item type:
 *   • type "organic"      — { rank_group, rank_absolute, domain, title, url,
 *                             description, breadcrumb }
 *
 * Tier: byok / aggregator. GDPR / ToS: DataForSEO holds the licensed obligations;
 * legal sign-off required before production. Never store personal data beyond what
 * the contract permits.
 */

import type { SerpAdapter, SerpResponse, SerpQueryParams, SerpItem, SerpKind } from '../index';
import { getSecret, getSecretOrThrow } from '../../secrets';

const BASE = 'https://api.dataforseo.com';
const ENDPOINT: Record<SerpKind, string> = {
  news:    '/v3/serp/google/news/live/advanced',
  organic: '/v3/serp/google/organic/live/advanced',
};

async function requireCredentials(): Promise<{ login: string; apiKey: string }> {
  const login = await getSecret('DATAFORSEO_LOGIN');
  const apiKey = await getSecretOrThrow('DATAFORSEO_API_KEY');
  if (!login) throw new Error('provider key required: DATAFORSEO_LOGIN not configured (set env or Supabase Vault)');
  return { login, apiKey };
}
function authHeader(login: string, apiKey: string): string {
  return `Basic ${Buffer.from(`${login}:${apiKey}`).toString('base64')}`;
}
function str(v: unknown): string | undefined { return typeof v === 'string' && v !== '' ? v : undefined; }
function n(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

/** Flatten one SERP result item (and any nested top_stories elements) into SerpItems. */
function collect(item: Record<string, unknown>, kind: SerpKind, out: SerpItem[]): void {
  const type = str(item.type);
  if (type === 'top_stories' && Array.isArray(item.items)) {
    for (const el of item.items as Record<string, unknown>[]) {
      const url = str(el.url);
      if (!str(el.title) && !url) continue;
      out.push({
        kind, title: str(el.title) ?? 'Untitled', url: url ?? null,
        domain: str(el.domain), source: str(el.source),
        timestamp: str(el.timestamp) ?? str(el.date), rank: n(el.rank_absolute),
      });
    }
    return;
  }
  // news_search | organic (and any flat result carrying a title/url)
  const url = str(item.url);
  if (!str(item.title) && !url) return;
  out.push({
    kind, title: str(item.title) ?? 'Untitled', url: url ?? null,
    domain: str(item.domain), source: str(item.source),
    snippet: str(item.snippet) ?? str(item.description),
    timestamp: str(item.timestamp), rank: n(item.rank_absolute),
  });
}

export class DataForSeoSerpAdapter implements SerpAdapter {
  readonly name = 'dataforseo';

  async getSerp({ keyword, type, limit = 20, locationCode = 2826, languageCode = 'en' }: SerpQueryParams): Promise<SerpResponse> {
    const { login, apiKey } = await requireCredentials();
    const endpoint = ENDPOINT[type];
    const body = JSON.stringify([{
      keyword,
      location_code: locationCode,
      language_code: languageCode,
      depth: Math.min(Math.max(limit, 10), 100), // billed per 10
    }]);

    const res = await fetch(`${BASE}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: authHeader(login, apiKey), 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`DataForSEO SERP ${type} returned HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    if ((data.status_code as number) !== 20000) {
      throw new Error(`DataForSEO API error ${data.status_code}: ${data.status_message}`);
    }
    const tasks = Array.isArray(data.tasks) ? data.tasks as Record<string, unknown>[] : [];
    const task = tasks[0];
    if (!task || (task.status_code as number) >= 40000) {
      throw new Error(`DataForSEO SERP task error ${task?.status_code}: ${task?.status_message}`);
    }
    const result = Array.isArray(task.result) ? task.result as Record<string, unknown>[] : [];
    const items: SerpItem[] = [];
    for (const r of result) {
      const rItems = Array.isArray(r.items) ? r.items as Record<string, unknown>[] : [];
      for (const it of rItems) collect(it, type, items);
    }
    return { items: items.slice(0, limit), provider: 'dataforseo' };
  }
}
