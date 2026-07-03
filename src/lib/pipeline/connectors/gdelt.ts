/**
 * KINTEL v2.1 — GDELT declarative connector (PRD §8.2/§8.5)
 *
 * First REAL fetcher through the declarative framework: calls the keyless
 * GDELT DOC 2.0 API (mode=artlist&format=json) and normalises the article
 * list into RawBatch records matching the TRUE input shape of the 'gdelt'
 * mapper (src/lib/ontology/mappers/gdelt.ts):
 *
 *   { id, name, url, type, date? }   // artlist carries no lat/lng/tone
 *
 * Expectations (matched to what mapGdeltEvent actually requires):
 *  - HARD: a usable event identity — non-empty `name`, or numeric lat+lng.
 *    Without it the mapper silently drops the record, so the gate holds the
 *    ENTIRE batch back loudly instead ("better stale than wrong").
 *  - WARN: `url` and `date` are nice-to-haves (provenance/link-out and
 *    recency); the mapper tolerates their absence.
 *
 * Failure contract (NFR §15.3 — never silent):
 *  - network errors from the injected fetcher propagate (caller handles);
 *  - non-200 responses throw with the HTTP status;
 *  - unexpected response shapes throw — records are NEVER fabricated.
 */

import { required } from '../expectations';
import type { ConnectorDef, Expectation, RawBatch } from '../types';

// ---------------------------------------------------------------------------
// Fetch contract
// ---------------------------------------------------------------------------

/** Minimal structural fetch contract — globalThis.fetch satisfies it. */
export type GdeltFetchImpl = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Per-run parameters; every field has a sane default. */
export interface GdeltFetchContext {
  /** GDELT DOC 2.0 query string (their boolean syntax). */
  query?: string;
  /** Max articles to request — clamped to the GDELT cap of 250. */
  maxRecords?: number;
  /** ISO 8601 lower bound — converted to a GDELT `timespan` in minutes. */
  since?: string;
}

/** ConnectorDef whose fetch additionally accepts per-run GDELT params. */
export interface GdeltConnectorDef extends ConnectorDef {
  fetch(ctx?: GdeltFetchContext): Promise<RawBatch>;
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

export const GDELT_DOC_API_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

const DEFAULT_QUERY = '(geopolitics OR sanctions OR "supply chain" OR "commodity markets")';
const DEFAULT_MAX_RECORDS = 100;
const GDELT_MAX_RECORDS_CAP = 250;
const DEFAULT_TIMESPAN = '1d';

/** Clamp requested record count into GDELT's legal [1, 250] window. */
function clampMaxRecords(requested: number | undefined): number {
  if (typeof requested !== 'number' || Number.isNaN(requested)) return DEFAULT_MAX_RECORDS;
  return Math.min(GDELT_MAX_RECORDS_CAP, Math.max(1, Math.floor(requested)));
}

/** Convert ctx.since into a GDELT timespan ('NNNmin'); default '1d' if absent/unparseable. */
function timespanFrom(since: string | undefined, nowMs: number): string {
  if (typeof since !== 'string' || since === '') return DEFAULT_TIMESPAN;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return DEFAULT_TIMESPAN;
  const minutes = Math.max(1, Math.ceil((nowMs - sinceMs) / 60_000));
  return `${minutes}min`;
}

/** Build the DOC 2.0 artlist URL from ctx params with sane defaults. */
export function buildGdeltDocUrl(ctx: GdeltFetchContext = {}, nowMs: number = Date.now()): string {
  const params = new URLSearchParams({
    query: ctx.query && ctx.query.trim() !== '' ? ctx.query : DEFAULT_QUERY,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(clampMaxRecords(ctx.maxRecords)),
    timespan: timespanFrom(ctx.since, nowMs),
  });
  return `${GDELT_DOC_API_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Normalisation — GDELT artlist article → mapper input record
// ---------------------------------------------------------------------------

/** GDELT 'YYYYMMDDTHHMMSSZ' seendate → ISO 8601; unrecognised strings pass through. */
function seendateToIso(seendate: unknown): string | undefined {
  if (typeof seendate !== 'string' || seendate === '') return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(seendate);
  if (!match) return seendate; // real data, unexpected format — keep, never invent
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

/** Normalise one artlist article into the mapGdeltEvent input shape. */
function normaliseArticle(article: unknown, index: number): Record<string, unknown> {
  const item = (article ?? {}) as Record<string, unknown>;
  const url = typeof item.url === 'string' ? item.url : '';
  const title = typeof item.title === 'string' ? item.title : '';
  const record: Record<string, unknown> = {
    id: url !== '' ? `gdelt-doc:${url}` : `gdelt-doc-${index}`,
    name: title,
    url,
    type: 'news',
  };
  const date = seendateToIso(item.seendate);
  if (date !== undefined) record.date = date;
  // Pass-through context fields (mapper ignores unknown keys; kept for provenance.raw)
  if (typeof item.domain === 'string') record.domain = item.domain;
  if (typeof item.language === 'string') record.language = item.language;
  if (typeof item.sourcecountry === 'string') record.sourcecountry = item.sourcecountry;
  return record;
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/** True iff the value is a non-empty string. */
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/**
 * HARD: mapGdeltEvent requires a non-empty name OR numeric lat+lng to emit
 * an Event entity (otherwise it silently drops the record) — the gate makes
 * that requirement loud and batch-blocking instead.
 */
const gdeltUsableEvent: Expectation = {
  name: 'gdelt-usable-event',
  level: 'hard',
  description:
    'Record must carry a non-empty name (article title) or numeric lat/lng — ' +
    'without either the gdelt mapper cannot produce an Event entity',
  check(record: unknown): boolean {
    if (record === null || typeof record !== 'object') return false;
    const item = record as Record<string, unknown>;
    if (nonEmptyString(item.name)) return true;
    return typeof item.lat === 'number' && !Number.isNaN(item.lat)
      && typeof item.lng === 'number' && !Number.isNaN(item.lng);
  },
};

/** Data expectations for the GDELT source, ordered hard-first. */
export const GDELT_EXPECTATIONS: Expectation[] = [
  gdeltUsableEvent,
  required('url', 'warn'),
  required('date', 'warn'),
];

// ---------------------------------------------------------------------------
// Connector factory
// ---------------------------------------------------------------------------

/**
 * Build the declarative GDELT connector over the real, keyless DOC 2.0 API.
 * The fetch implementation is injectable for tests; production callers can
 * rely on the globalThis.fetch default.
 */
export function makeGdeltConnector(
  fetchImpl: GdeltFetchImpl = globalThis.fetch,
): GdeltConnectorDef {
  return {
    sourceKey: 'gdelt',
    mapperKey: 'gdelt',
    expectations: GDELT_EXPECTATIONS,
    async fetch(ctx: GdeltFetchContext = {}): Promise<RawBatch> {
      const url = buildGdeltDocUrl(ctx);
      const response = await fetchImpl(url); // network errors propagate — caller handles
      if (!response.ok) {
        throw new Error(`GDELT DOC API request failed: HTTP ${response.status} (${url})`);
      }
      const body: unknown = await response.json();
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(
          'GDELT DOC API returned an unexpected response shape (expected a JSON object ' +
          'with an articles array) — refusing to fabricate records',
        );
      }
      const articles = (body as Record<string, unknown>).articles ?? [];
      if (!Array.isArray(articles)) {
        throw new Error(
          "GDELT DOC API returned an unexpected 'articles' value (expected an array) — " +
          'refusing to fabricate records',
        );
      }
      return {
        sourceKey: 'gdelt',
        fetchedAt: new Date().toISOString(),
        records: articles.map((article, index) => normaliseArticle(article, index)),
      };
    },
  };
}
