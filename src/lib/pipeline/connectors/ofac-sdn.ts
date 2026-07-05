/**
 * KINTEL WS-1 — OFAC SDN declarative connector (clean-room)
 *
 * Fetches the OFAC SDN list and normalises each record into the
 * mapOfacSdnRecord input shape. Keyless. Pure slice: the fetcher is injected,
 * so no network/DB access lives here (mirrors the gdelt connector).
 *
 * Source data: the OFAC SDN list is US Government public domain (17 U.S.C. 105).
 * We read the simple-CSV projection hosted by OpenSanctions; the *content* is
 * OFAC public-domain data (recorded as licence_class 'public-open').
 *
 * GOVERNANCE (non-negotiable):
 *  - HARD expectation: every record must carry a usable identity (name or id);
 *    otherwise the whole batch is held back loudly ("better stale than wrong").
 *  - Output flows fetch -> expectations(hard-fail) -> mapper -> create_entity
 *    proposals only (intel.proposed_edit). A sanctions match is HITL; this
 *    connector never asserts truth or auto-actions.
 *  - Records are NEVER fabricated; unexpected shapes throw loudly.
 */

import { required } from '../expectations';
import type { ConnectorDef, Expectation, RawBatch } from '../types';

/** Minimal structural fetch contract — globalThis.fetch satisfies it. */
export type OfacFetchImpl = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * OFAC SDN simple-CSV (OpenSanctions projection of US-public-domain OFAC data).
 * Columns: id, schema, name, aliases, birth_date, countries, addresses,
 *          identifiers, sanctions, phones, emails, dataset, first_seen, ...
 */
export const OFAC_SDN_CSV_URL =
  'https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv';

// ---------------------------------------------------------------------------
// Dependency-free CSV parser (RFC 4180-ish: quotes, escaped quotes, CRLF/LF).
// Returns one object per data row keyed by the header row.
// ---------------------------------------------------------------------------

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; continue; }
    if (c === '\r') { continue; } // swallow CR (CRLF handled by \n)
    field += c;
  }
  // Flush trailing field/row (file may not end with newline)
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length === 0) return [];
  const header = rows[0];
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length === 1 && cells[0] === '') continue; // skip blank line
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] ?? '';
    out.push(obj);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Expectations (hard-first)
// ---------------------------------------------------------------------------

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v !== '';
}

/** HARD: OFAC screening needs an identity — a non-empty name or id. */
const ofacUsableIdentity: Expectation = {
  name: 'ofac-usable-identity',
  level: 'hard',
  description:
    'Record must carry a non-empty name or id — the ofac-sdn mapper cannot ' +
    'resolve a sanctions entity without one',
  check(record: unknown): boolean {
    if (record === null || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    return nonEmptyString(r.name) || nonEmptyString(r.id);
  },
};

/** Data expectations for OFAC SDN, ordered hard-first. */
export const OFAC_EXPECTATIONS: Expectation[] = [
  ofacUsableIdentity,
  required('name', 'warn'),
  required('countries', 'warn'),
];

// ---------------------------------------------------------------------------
// Connector factory
// ---------------------------------------------------------------------------

/**
 * Build the OFAC SDN connector. Inject a fetcher (globalThis.fetch in prod;
 * a stub in tests). Failures throw loudly — records are never fabricated.
 */
export function createOfacSdnConnector(
  fetchImpl: OfacFetchImpl,
  url: string = OFAC_SDN_CSV_URL,
): ConnectorDef {
  return {
    sourceKey: 'ofac-sdn',
    mapperKey: 'ofac-sdn',
    expectations: OFAC_EXPECTATIONS,
    async fetch(): Promise<RawBatch> {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`OFAC SDN fetch failed: HTTP ${res.status}`);
      const csv = await res.text();
      const records = parseCsv(csv);
      return {
        sourceKey: 'ofac-sdn',
        fetchedAt: new Date().toISOString(),
        records,
      };
    },
  };
}
