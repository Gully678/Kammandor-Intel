/**
 * Mission A — kammandor-deals mapper + ingest opt-in tests
 *
 * Covers: entity mapping with preserved source-row ids, grounded link
 * emission, deterministic isDirectorOf, PII/figure non-promotion, payload
 * id + provenance folding through buildProposedEditsFromRecords, and the
 * no-regression guarantee for mappers that do NOT opt in.
 */

import { describe, it, expect } from 'vitest';
import { mapKammandorDealGraph, linkEvidencePath } from '../mappers/kammandor-deals';
import { buildProposedEditsFromRecords } from '../ingest';

const TENANT = '11111111-1111-4111-8111-111111111111';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERSON_ID  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEAL_ID    = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function graphRecord(overrides: Record<string, unknown> = {}) {
  return {
    record_type: 'deal_graph',
    companies: [
      { id: COMPANY_ID, name: 'Acme Trading FZE', jurisdiction: 'AE', website: 'https://acme.example', company_type: 'counterparty' },
    ],
    contacts: [
      { id: PERSON_ID, company_id: COMPANY_ID, full_name: 'Jane Smith', role_title: 'Managing Director', email: 'jane@acme.example', phone: '+971-000' },
    ],
    deals: [
      { id: DEAL_ID, deal_ref: 'PFO-D-001', name: 'Sugar ICUMSA 45 Supply', status: 'active', metadata: { amount_usd: 1000000 } },
    ],
    relationships: [
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', deal_id: DEAL_ID, party_type: 'company', company_id: COMPANY_ID, role: 'seller' },
    ],
    ...overrides,
  };
}

describe('mapKammandorDealGraph', () => {
  it('maps companies, contacts and deals to entities that KEEP their source-row uuids', () => {
    const { entities, preserveEntityIds } = mapKammandorDealGraph(graphRecord(), TENANT);
    expect(preserveEntityIds).toBe(true);
    expect(entities).toHaveLength(3);
    const ids = entities.map(e => e.id);
    expect(ids).toContain(COMPANY_ID);
    expect(ids).toContain(PERSON_ID);
    expect(ids).toContain(DEAL_ID);
    const company = entities.find(e => e.id === COMPANY_ID)!;
    expect(company.type).toBe('company');
    expect(company.canonical_name).toBe('Acme Trading FZE');
    expect(company.jurisdiction_code).toBe('AE');
  });

  it('never promotes figures or PII into entity properties (verbatim in provenance.raw only)', () => {
    const { entities, provenance } = mapKammandorDealGraph(graphRecord(), TENANT);
    const deal = entities.find(e => e.id === DEAL_ID)!;
    expect(JSON.stringify(deal.properties)).not.toContain('1000000');
    const person = entities.find(e => e.id === PERSON_ID)!;
    expect(JSON.stringify(person.properties)).not.toContain('jane@acme.example');
    const dealProv = provenance.find(p => p.entity_id === DEAL_ID && !p.property_path)!;
    expect(JSON.stringify(dealProv.raw)).toContain('1000000'); // verbatim lineage
    expect(dealProv.source_key).toBe('kammandor-deals');
    expect(dealProv.confidence).toBe(1);
  });

  it('emits isNamedInDeal links only when both endpoints are sibling entities', () => {
    const { links } = mapKammandorDealGraph(graphRecord(), TENANT);
    const named = links.filter(l => l.type === 'isNamedInDeal');
    expect(named).toHaveLength(1);
    expect(named[0].source_entity_id).toBe(COMPANY_ID);
    expect(named[0].target_entity_id).toBe(DEAL_ID);
    expect(named[0].properties.role).toBe('seller');

    // Ungrounded relationship (deal not in this batch) is skipped, silently but deliberately.
    const rec = graphRecord({ relationships: [{ deal_id: '99999999-9999-4999-8999-999999999999', party_type: 'company', company_id: COMPANY_ID }] });
    expect(mapKammandorDealGraph(rec, TENANT).links.filter(l => l.type === 'isNamedInDeal')).toHaveLength(0);
  });

  it('emits isDirectorOf only when the role title literally says director', () => {
    const { links } = mapKammandorDealGraph(graphRecord(), TENANT);
    const director = links.filter(l => l.type === 'isDirectorOf');
    expect(director).toHaveLength(1);
    expect(director[0].source_entity_id).toBe(PERSON_ID);
    expect(director[0].target_entity_id).toBe(COMPANY_ID);

    const rec = graphRecord({
      contacts: [{ id: PERSON_ID, company_id: COMPANY_ID, full_name: 'Jane Smith', role_title: 'Analyst' }],
    });
    expect(mapKammandorDealGraph(rec, TENANT).links.filter(l => l.type === 'isDirectorOf')).toHaveLength(0);
  });

  it('skips malformed rows without aborting the batch', () => {
    const rec = graphRecord({
      companies: [
        { id: 'not-a-uuid', name: 'Bad Co' },
        { id: COMPANY_ID, name: 'Acme Trading FZE' },
        { id: COMPANY_ID, name: 'Duplicate Acme' },
      ],
    });
    const { entities } = mapKammandorDealGraph(rec, TENANT);
    expect(entities.filter(e => e.type === 'company')).toHaveLength(1);
  });
});

describe('buildProposedEditsFromRecords — kammandor-deals opt-in', () => {
  it('folds the preserved id AND provenance into create_entity payloads', () => {
    const { edits, skipped } = buildProposedEditsFromRecords('kammandor-deals', TENANT, [graphRecord()]);
    expect(skipped).toBe(0);

    const entityEdits = edits.filter(e => e.kind === 'create_entity');
    expect(entityEdits).toHaveLength(3);
    for (const edit of entityEdits) {
      expect(typeof edit.payload.id).toBe('string');
      const prov = edit.payload.provenance as Record<string, unknown>[];
      expect(Array.isArray(prov)).toBe(true);
      expect(prov[0].source_key).toBe('kammandor-deals');
      expect(prov[0].raw).toBeDefined();
      expect(edit.evaluation).toBeDefined();
    }
  });

  it('link payloads reference sibling entity ids and carry their evidence row', () => {
    const { edits } = buildProposedEditsFromRecords('kammandor-deals', TENANT, [graphRecord()]);
    const linkEdits = edits.filter(e => e.kind === 'create_link');
    expect(linkEdits.length).toBe(2); // isNamedInDeal + isDirectorOf

    const named = linkEdits.find(e => (e.payload as { type?: string }).type === 'isNamedInDeal')!;
    expect(named.payload.source_entity_id).toBe(COMPANY_ID);
    expect(named.payload.target_entity_id).toBe(DEAL_ID);
    const prov = named.payload.provenance as Record<string, unknown>[];
    expect(prov[0].property_path).toBe(linkEvidencePath('isNamedInDeal', DEAL_ID));
  });

  it('does NOT alter payloads for mappers that have not opted in (no regression)', () => {
    const { edits } = buildProposedEditsFromRecords('world-bank', TENANT, [
      { id: 'GBR', iso2Code: 'GB', name: 'United Kingdom', capitalCity: 'London', region: { id: 'ECS', value: 'Europe' }, incomeLevel: { id: 'HIC', value: 'High income' } },
    ]);
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.payload.id).toBeUndefined();
      expect(edit.payload.provenance).toBeUndefined();
    }
  });
});
