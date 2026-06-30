/**
 * KINTEL Phase 2 — SEC EDGAR filing mapper
 * Transforms a SEC EDGAR filing record into ontology objects.
 *
 * Source key: 'sec-edgar'
 * API: https://data.sec.gov/submissions/CIK{cik}.json  (company submissions)
 *
 * Produces:
 *   - Filing entity (type='filing')
 *   - Issuer Company entity (type='company')
 *   - filedWith link: Filing → Company
 */

import type { Entity, Link, Provenance } from '../types';
import type { MapperResult } from './gleif';

export type { MapperResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeEntityBase(tenantId: string): Pick<Entity, 'tenant_id' | 'properties' | 'created_at' | 'updated_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now(), updated_at: now() };
}

function makeLinkBase(tenantId: string): Pick<Link, 'tenant_id' | 'properties' | 'created_at'> {
  return { tenant_id: tenantId, properties: {}, created_at: now() };
}

function pseudoUuid(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(h).toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

// ---------------------------------------------------------------------------
// Main mapper
// ---------------------------------------------------------------------------

/**
 * Map a SEC EDGAR filing record to ontology objects.
 *
 * Expected input shape:
 * {
 *   accessionNumber: string,   // e.g. '0001564590-22-026878'
 *   form:            string,   // e.g. '10-K', '8-K', 'S-1'
 *   filingDate:      string,   // ISO date e.g. '2022-09-30'
 *   issuer: {
 *     cik:          string,    // Central Index Key
 *     name:         string,
 *     tickers?:     string[],
 *     sic?:         string,
 *     stateOfIncorporation?: string,
 *   }
 * }
 */
export function mapSecEdgarFiling(input: unknown, tenantId: string): MapperResult {
  const record = (input as Record<string, unknown>) ?? {};
  const issuer  = (record.issuer ?? {}) as Record<string, unknown>;

  // --- Accession / filing metadata
  const accessionNumber: string = typeof record.accessionNumber === 'string' ? record.accessionNumber : '';
  const form:            string = typeof record.form            === 'string' ? record.form            : '';
  const filingDate:      string = typeof record.filingDate      === 'string' ? record.filingDate      : '';

  // --- Issuer metadata
  const cik:          string = typeof issuer.cik  === 'string' ? issuer.cik  : '';
  const issuerName:   string = typeof issuer.name === 'string' ? issuer.name : '';
  const tickers:    string[] = Array.isArray(issuer.tickers)
    ? (issuer.tickers as unknown[]).filter((t): t is string => typeof t === 'string')
    : [];
  const sic:                string = typeof issuer.sic                   === 'string' ? issuer.sic                   : '';
  const stateOfIncorporation: string = typeof issuer.stateOfIncorporation === 'string' ? issuer.stateOfIncorporation : '';

  const entities:   Entity[]     = [];
  const links:      Link[]       = [];
  const provenance: Provenance[] = [];

  // --- Issuer company entity
  const issuerId = pseudoUuid(`sec:company:${cik || issuerName}`);
  const issuerEntity: Entity = {
    ...makeEntityBase(tenantId),
    id:             issuerId,
    type:           'company',
    canonical_name: issuerName || undefined,
    properties: {
      cik,
      tickers,
      sic,
      state_of_incorporation: stateOfIncorporation,
      source: 'sec-edgar',
    },
  };
  entities.push(issuerEntity);

  // --- Filing entity
  const filingId = pseudoUuid(`sec:filing:${accessionNumber || `${cik}:${form}:${filingDate}`}`);
  const filingEntity: Entity = {
    ...makeEntityBase(tenantId),
    id:             filingId,
    type:           'filing',
    canonical_name: accessionNumber ? `${form} — ${accessionNumber}` : form || undefined,
    properties: {
      accession_number: accessionNumber,
      form,
      filing_date:      filingDate,
      source:           'sec-edgar',
    },
  };
  entities.push(filingEntity);

  // --- filedWith link: Filing → Company (issuer)
  links.push({
    ...makeLinkBase(tenantId),
    id:               pseudoUuid(`sec:link:filedWith:${filingId}:${issuerId}`),
    source_entity_id: filingId,
    target_entity_id: issuerId,
    type:             'filedWith',
    properties: {
      form,
      filing_date: filingDate,
    },
  });

  // --- Provenance
  provenance.push({
    id:         pseudoUuid(`sec:prov:${accessionNumber || filingId}`),
    entity_id:  filingId,
    source_key: 'sec-edgar',
    source_url: cik
      ? `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`
      : undefined,
    fetched_at: now(),
    confidence: 0.9,
    raw:        input,
  });

  return { entities, links, provenance };
}
