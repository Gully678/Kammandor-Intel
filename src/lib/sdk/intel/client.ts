/**
 * KINTEL v2.3 — Typed Intel SDK client (PRD §10.1, OSDK-equivalent)
 *
 * The thin, fully typed client any tenant or third-party front end builds
 * on. It talks ONLY to the governed read surface:
 *
 *   listObjects  → GET  /api/ontology/objects
 *   getObject    → GET  /api/ontology/objects/[id]
 *   query        → POST /api/ontology/query   (the §10.2 graph surface)
 *   listAlerts   → GET  /api/signals/alerts
 *   listActions  → GET  /api/ontology/actions      (Mission C, v1 draft)
 *   requestAction→ POST /api/ontology/actions      (Mission C, v1 draft)
 *
 * Request/response types are the EXACT types the routes use
 * (src/lib/sdk/intel/types.ts — single source of truth, which itself
 * imports from '@/lib/ontology/types'). No duplication, no drift.
 *
 * Auth: pass `token` (sent as `Authorization: Bearer …`) and/or
 * `handoffToken` (the signed tenant handoff, sent as `x-intel-handoff` —
 * see src/lib/handoff/resolveTenant.ts's SHARED CONTRACT). The server
 * resolves the tenant exclusively from the signed handoff; the client
 * never sends an org id.
 *
 * Errors: every non-2xx response is thrown as a typed IntelApiError
 * carrying the HTTP status and the server's plain-language message.
 * This module has NO dependency on Next.js — safe for any JS runtime.
 */

import type {
  GraphQuery,
  GraphQueryResponse,
  ListActionsParams,
  ListActionsResponse,
  ListAlertsParams,
  ListAlertsResponse,
  ListObjectsParams,
  ListObjectsResponse,
  ObjectDetailResponse,
  RequestActionInput,
  RequestActionResponse,
} from './types';

export interface IntelClientOptions {
  /** Origin (and optional base path) of the Intel API, e.g. 'https://intel.example'. */
  baseUrl: string;
  /** Bearer token, sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Signed tenant handoff token, sent as `x-intel-handoff`. */
  handoffToken?: string;
  /** Custom fetch (tests, polyfills). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

/** Typed transport error: HTTP status + the server's message. */
export class IntelApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'IntelApiError';
    this.status = status;
  }
}

export interface IntelClient {
  /** List governed objects — filter by type, name search, keyset pagination. */
  listObjects(params?: ListObjectsParams): Promise<ListObjectsResponse>;
  /** The full governed object view: links + provenance/licence + versions. */
  getObject(id: string): Promise<ObjectDetailResponse>;
  /** Graph-shaped read (max depth 3) — returns nodes + edges. */
  query(graphQuery: GraphQuery): Promise<GraphQueryResponse>;
  /** The tenant's alert feed (dashboard feed). */
  listAlerts(params?: ListAlertsParams): Promise<ListAlertsResponse>;
  /** List the tenant's watchlists (header + array terms). */
  listWatchlists(): Promise<{ watchlists: unknown[] }>;
  /** Create/replace a watchlist (scope org|deal|campaign, ref = deal/campaign id). */
  upsertWatchlist(input: WatchlistUpsertInput): Promise<{ ok: boolean; watchlist: unknown }>;
  /** List typed subjects (people/companies/products/creators/keywords/hashtags…). */
  listWatchlistItems(params?: WatchlistItemsQuery): Promise<{ items: unknown[] }>;
  /** Set/add typed subjects for a watchlist (mode 'replace' default, or 'add'). */
  setWatchlistItems(input: SetWatchlistItemsInput): Promise<{ ok: boolean; count: number; items: unknown[] }>;
  /** Remove typed subjects (by ids, or by scope/ref[+kinds/values]). */
  removeWatchlistItems(input: RemoveWatchlistItemsInput): Promise<{ ok: boolean; removed: number }>;
  /** List the tenant's action queue (Mission C, v1 draft) — optionally filter by status. */
  listActions(params?: ListActionsParams): Promise<ListActionsResponse>;
  /** Request a new action — server resolves risk_tier from the catalogue and inserts 'queued'/'awaiting_approval' only, never 'approved'. */
  requestAction(input: RequestActionInput): Promise<RequestActionResponse>;
}

export type WatchlistScope = 'org' | 'deal' | 'campaign';
export type WatchlistItemKind =
  | 'keyword' | 'hashtag' | 'handle' | 'person' | 'company' | 'product'
  | 'creator' | 'commentator' | 'ticker' | 'geo' | 'topic';
export interface WatchlistUpsertInput {
  scope?: WatchlistScope; ref?: string; label?: string; source?: string; active?: boolean;
  keywords?: string[]; entities?: string[]; tickers?: string[]; handles?: string[]; geos?: string[];
}
export interface WatchlistItemInput { kind: WatchlistItemKind; value: string; label?: string; source?: string; }
export interface WatchlistItemsQuery { scope?: WatchlistScope; ref?: string; }
export interface SetWatchlistItemsInput { scope?: WatchlistScope; ref?: string; mode?: 'add' | 'replace'; items: WatchlistItemInput[]; }
export interface RemoveWatchlistItemsInput { scope?: WatchlistScope; ref?: string; ids?: string[]; kinds?: WatchlistItemKind[]; values?: string[]; }

export function createIntelClient(options: IntelClientOptions): IntelClient {
  const { baseUrl, token, handoffToken, fetchImpl } = options;

  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('createIntelClient: "baseUrl" is required.');
  }
  if (!token && !handoffToken) {
    throw new Error(
      'createIntelClient: provide "token" and/or "handoffToken" — the API rejects anonymous reads.',
    );
  }

  const root = baseUrl.replace(/\/+$/, '');
  const doFetch: typeof fetch = fetchImpl ?? fetch;

  const baseHeaders: Record<string, string> = { Accept: 'application/json' };
  if (token) baseHeaders.Authorization = `Bearer ${token}`;
  if (handoffToken) baseHeaders['x-intel-handoff'] = handoffToken;

  async function request<T>(
    path: string,
    init: { method: 'GET' | 'POST' | 'DELETE'; query?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    let url = `${root}${path}`;
    if (init.query) {
      const qs = new URLSearchParams(init.query).toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { ...baseHeaders };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let res: Response;
    try {
      res = await doFetch(url, { method: init.method, headers, ...(body !== undefined ? { body } : {}) });
    } catch (err) {
      throw new IntelApiError(
        0,
        err instanceof Error ? `Network error: ${err.message}` : 'Network error.',
      );
    }

    if (!res.ok) {
      throw new IntelApiError(res.status, await extractErrorMessage(res));
    }
    return (await res.json()) as T;
  }

  return {
    listObjects(params: ListObjectsParams = {}): Promise<ListObjectsResponse> {
      const query: Record<string, string> = {};
      if (params.type !== undefined) query.type = params.type;
      if (params.q !== undefined) query.q = params.q;
      if (params.limit !== undefined) query.limit = String(params.limit);
      if (params.cursor !== undefined) query.cursor = params.cursor;
      return request<ListObjectsResponse>('/api/ontology/objects', { method: 'GET', query });
    },

    getObject(id: string): Promise<ObjectDetailResponse> {
      if (!id) throw new IntelApiError(400, 'getObject: "id" is required.');
      return request<ObjectDetailResponse>(
        `/api/ontology/objects/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );
    },

    query(graphQuery: GraphQuery): Promise<GraphQueryResponse> {
      return request<GraphQueryResponse>('/api/ontology/query', {
        method: 'POST',
        body: graphQuery,
      });
    },

    listAlerts(params: ListAlertsParams = {}): Promise<ListAlertsResponse> {
      const query: Record<string, string> = {};
      if (params.status !== undefined) query.status = params.status;
      if (params.severity !== undefined) query.severity = params.severity;
      if (params.limit !== undefined) query.limit = String(params.limit);
      return request<ListAlertsResponse>('/api/signals/alerts', { method: 'GET', query });
    },

    listWatchlists() {
      return request<{ watchlists: unknown[] }>('/api/intel/watchlist', { method: 'GET' });
    },
    upsertWatchlist(input: WatchlistUpsertInput) {
      return request<{ ok: boolean; watchlist: unknown }>('/api/intel/watchlist', { method: 'POST', body: input });
    },
    listWatchlistItems(params: WatchlistItemsQuery = {}) {
      const query: Record<string, string> = {};
      if (params.scope !== undefined) query.scope = params.scope;
      if (params.ref !== undefined) query.ref = params.ref;
      return request<{ items: unknown[] }>('/api/intel/watchlist/items', { method: 'GET', query });
    },
    setWatchlistItems(input: SetWatchlistItemsInput) {
      return request<{ ok: boolean; count: number; items: unknown[] }>('/api/intel/watchlist/items', { method: 'POST', body: input });
    },
    removeWatchlistItems(input: RemoveWatchlistItemsInput) {
      return request<{ ok: boolean; removed: number }>('/api/intel/watchlist/items', { method: 'DELETE', body: input });
    },

    listActions(params: ListActionsParams = {}): Promise<ListActionsResponse> {
      const query: Record<string, string> = {};
      if (params.status !== undefined) query.status = params.status;
      if (params.limit !== undefined) query.limit = String(params.limit);
      return request<ListActionsResponse>('/api/ontology/actions', { method: 'GET', query });
    },
    requestAction(input: RequestActionInput): Promise<RequestActionResponse> {
      return request<RequestActionResponse>('/api/ontology/actions', { method: 'POST', body: input });
    },
  };
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const parsed: unknown = await res.json();
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).error === 'string'
    ) {
      return (parsed as Record<string, string>).error;
    }
  } catch {
    // fall through to the generic message
  }
  return `Request failed with status ${res.status}.`;
}
