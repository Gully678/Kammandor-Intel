/**
 * KINTEL WS-1 — OFAC SDN connector tests (clean-room)
 *
 * NO LIVE NETWORK: every test injects a mock fetchImpl. The real OpenSanctions
 * CSV is never fetched from this suite. Mirrors connectors/__tests__/gdelt.test.ts.
 */

import { describe, it, expect } from 'vitest';

import { runExpectations } from '../../expectations';
import {
  createOfacSdnConnector,
  parseCsv,
  OFAC_EXPECTATIONS,
  type OfacFetchImpl,
} from '../ofac-sdn';
import { mapOfacSdnRecord } from '@/lib/ontology/mappers';

const TENANT_ID = 'b0000000-0000-4000-8000-000000000001';

// Realistic targets.simple.csv projection (header + 2 data rows, one quoted).
const CSV_FIXTURE =
  'id,schema,name,aliases,countries,sanctions\n' +
  'ofac-12345,Person,"Doe, John",Johnny,ru,SDN\n' +
  'ofac-67890,Organization,Acme Holdings Ltd,,ir,SDN\n';

function mockFetch(body: string, ok = true, status = 200): OfacFetchImpl {
  return async () => ({ ok, status, text: async () => body });
}

describe('parseCsv', () => {
  it('parses header + rows, handling quoted fields with commas', () => {
    const rows = parseCsv(CSV_FIXTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('ofac-12345');
    expect(rows[0].name).toBe('Doe, John'); // quoted comma preserved
    expect(rows[1].schema).toBe('Organization');
  });

  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('createOfacSdnConnector', () => {
  it('fetches + parses into the mapper input shape', async () => {
    const connector = createOfacSdnConnector(mockFetch(CSV_FIXTURE));
    const batch = await connector.fetch();
    expect(batch.sourceKey).toBe('ofac-sdn');
    expect(batch.records).toHaveLength(2);
    expect((batch.records[0] as Record<string, unknown>).name).toBe('Doe, John');
  });

  it('throws loudly on a non-ok fetch (never fabricates)', async () => {
    const connector = createOfacSdnConnector(mockFetch('', false, 503));
    await expect(connector.fetch()).rejects.toThrow(/OFAC SDN fetch failed/);
  });
});

describe('OFAC expectations (hard-first)', () => {
  it('passes when every record carries a usable identity', async () => {
    const connector = createOfacSdnConnector(mockFetch(CSV_FIXTURE));
    const batch = await connector.fetch();
    const report = runExpectations(batch.records, OFAC_EXPECTATIONS);
    expect(report.batchAccepted).toBe(true);
  });

  it('hard-fails when a record has neither name nor id', async () => {
    const badCsv = 'id,schema,name\n,Person,\n';
    const connector = createOfacSdnConnector(mockFetch(badCsv));
    const batch = await connector.fetch();
    const report = runExpectations(batch.records, OFAC_EXPECTATIONS);
    expect(report.batchAccepted).toBe(false);
  });
});

describe('mapOfacSdnRecord', () => {
  it('maps a record into a sanctions-category entity (HITL, no asserted truth)', () => {
    const rows = parseCsv(CSV_FIXTURE);
    const result = mapOfacSdnRecord(rows[0], TENANT_ID);
    expect(result.entities).toHaveLength(1);
    const e = result.entities[0];
    expect(e.tenant_id).toBe(TENANT_ID);
    expect(e.risk_category).toBe('sanctions');
    expect(e.canonical_name).toBe('Doe, John');
    expect(e.type).toBe('person');
  });

  it('no-ops a record with no usable identity', () => {
    const result = mapOfacSdnRecord({ schema: 'Person' }, TENANT_ID);
    expect(result.entities).toHaveLength(0);
  });
});
