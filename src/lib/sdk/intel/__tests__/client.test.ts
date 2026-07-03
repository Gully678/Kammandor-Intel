/**
 * KINTEL v2.3 — Intel SDK client tests (PRD §10.1)
 *
 * Written FIRST (TDD). Covers:
 *   - URL + query-string construction for every method
 *   - auth header construction (Authorization bearer / x-intel-handoff)
 *   - typed response passthrough (the client returns the parsed body as-is)
 *   - IntelApiError with status + server message on non-2xx
 *   - constructor guards (baseUrl + at least one credential required)
 */

import { describe, it, expect, vi } from 'vitest';
import { createIntelClient, IntelApiError } from '../client';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(status = 200, body: unknown = {}): { impl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('createIntelClient', () => {
  it('throws when baseUrl is missing or no credential is supplied', () => {
    expect(() => createIntelClient({ baseUrl: '', token: 'x' })).toThrow();
    expect(() => createIntelClient({ baseUrl: 'https://intel.example' })).toThrow();
  });

  it('listObjects builds the URL with params and sends the Authorization header', async () => {
    const { impl, calls } = stubFetch(200, { objects: [], nextCursor: null });
    const client = createIntelClient({
      baseUrl: 'https://intel.example/',
      token: 'sdk-token',
      fetchImpl: impl,
    });

    const res = await client.listObjects({ type: 'company', q: 'pitt', limit: 25, cursor: 'CUR' });
    expect(res).toEqual({ objects: [], nextCursor: null });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe('https://intel.example');
    expect(url.pathname).toBe('/api/ontology/objects');
    expect(url.searchParams.get('type')).toBe('company');
    expect(url.searchParams.get('q')).toBe('pitt');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('CUR');
    expect(calls[0].headers.Authorization).toBe('Bearer sdk-token');
  });

  it('sends the handoff token via the x-intel-handoff header', async () => {
    const { impl, calls } = stubFetch(200, { alerts: [] });
    const client = createIntelClient({
      baseUrl: 'https://intel.example',
      handoffToken: 'signed-handoff',
      fetchImpl: impl,
    });

    await client.listAlerts({ severity: 'high', status: 'open' });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/signals/alerts');
    expect(url.searchParams.get('severity')).toBe('high');
    expect(url.searchParams.get('status')).toBe('open');
    expect(calls[0].headers['x-intel-handoff']).toBe('signed-handoff');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('getObject hits /api/ontology/objects/[id] and passes the typed body through', async () => {
    const detail = {
      object: { id: 'abc', type: 'company' },
      links: [],
      provenance: [{ source_key: 'gleif', licence_class: 'public-open' }],
      versions: [],
    };
    const { impl, calls } = stubFetch(200, detail);
    const client = createIntelClient({
      baseUrl: 'https://intel.example',
      token: 'sdk-token',
      fetchImpl: impl,
    });

    const res = await client.getObject('abc');
    expect(res).toEqual(detail);
    expect(new URL(calls[0].url).pathname).toBe('/api/ontology/objects/abc');
    expect(calls[0].method).toBe('GET');
  });

  it('query POSTs the graph query as JSON to /api/ontology/query', async () => {
    const { impl, calls } = stubFetch(200, { nodes: [], edges: [] });
    const client = createIntelClient({
      baseUrl: 'https://intel.example',
      token: 'sdk-token',
      fetchImpl: impl,
    });

    const q = { start: { type: 'company' as const }, traverse: [{ direction: 'out' as const }], limit: 10 };
    await client.query(q);

    expect(calls[0].method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/api/ontology/query');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual(q);
  });

  it('throws a typed IntelApiError with status and server message on non-2xx', async () => {
    const { impl } = stubFetch(500, { error: 'The object store could not be reached.' });
    const client = createIntelClient({
      baseUrl: 'https://intel.example',
      token: 'sdk-token',
      fetchImpl: impl,
    });

    const err = await client.listObjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntelApiError);
    expect((err as IntelApiError).status).toBe(500);
    expect((err as IntelApiError).message).toBe('The object store could not be reached.');
  });
});
