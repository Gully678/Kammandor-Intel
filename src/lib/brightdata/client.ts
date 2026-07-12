/**
 * KINTEL — Bright Data Datasets API v3 — shared client
 *
 * Verified endpoint paths (from https://docs.brightdata.com/datasets/scrapers/linkedin/async-requests):
 *   POST https://api.brightdata.com/datasets/v3/trigger?dataset_id={id}&format=json
 *        Body: JSON array of input objects (e.g. [{ url: "..." }] or [{ keyword: "..." }])
 *        Response: { snapshot_id: "s_..." }
 *
 *   GET  https://api.brightdata.com/datasets/v3/progress/{snapshot_id}
 *        Response: { status: "collecting" | "digesting" | "ready" | "failed" }
 *
 *   GET  https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json
 *        Response: JSON array of result records
 *
 *   POST https://api.brightdata.com/datasets/v3/scrape?dataset_id={id}&format=json
 *        Synchronous path (≤20 URLs); returns result array directly.
 *        Response: JSON array of result records (same shape as snapshot fetch)
 *
 * Auth: Bearer token — Authorization: Bearer BRIGHTDATA_API_KEY
 *
 * This is a licensed API client only. Bright Data handles proxy rotation,
 * anti-bot infrastructure, and parsing as part of their licensed data product.
 * Do NOT add any scraping/CAPTCHA-bypass logic here.
 */

import { getSecretOrThrow } from '../secrets';

const BD_BASE = 'https://api.brightdata.com';

async function requireToken(): Promise<string> {
  return getSecretOrThrow('BRIGHTDATA_API_KEY');
}

function bearerHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface BrightDataTriggerResult {
  snapshotId: string;
}

/**
 * Trigger an async collection.
 * POST /datasets/v3/trigger?dataset_id={datasetId}&format=json
 * Returns the snapshot_id to poll.
 */
export interface BrightDataTriggerOptions {
  /** Keyword-discovery collection — appends type=discover_new&discover_by=keyword. */
  discoverByKeyword?: boolean;
  /** Cap results per input (Bright Data limit_per_input). */
  limitPerInput?: number;
  /** Include the errors report with results. */
  includeErrors?: boolean;
}

export async function triggerCollection(
  datasetId: string,
  inputs: Record<string, unknown>[],
  opts: BrightDataTriggerOptions = {},
): Promise<BrightDataTriggerResult> {
  const token = await requireToken();
  let url = `${BD_BASE}/datasets/v3/trigger?dataset_id=${encodeURIComponent(datasetId)}&format=json`;
  // Bright Data keyword DISCOVERY requires these query params (verified against
  // docs.brightdata.com Web Scraper API "Scraper async requests"). Without them a
  // {keyword} body is not treated as a discovery input and returns nothing.
  if (opts.discoverByKeyword) url += '&type=discover_new&discover_by=keyword';
  if (opts.limitPerInput && opts.limitPerInput > 0) url += `&limit_per_input=${opts.limitPerInput}`;
  if (opts.includeErrors) url += '&include_errors=true';

  const res = await fetch(url, {
    method: 'POST',
    headers: bearerHeaders(token),
    body: JSON.stringify(inputs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bright Data trigger failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { snapshot_id?: string };
  if (!data.snapshot_id) {
    throw new Error('Bright Data trigger: no snapshot_id in response');
  }
  return { snapshotId: data.snapshot_id };
}

export type BrightDataSnapshotStatus = 'collecting' | 'digesting' | 'ready' | 'failed';

/**
 * Poll snapshot progress.
 * GET /datasets/v3/progress/{snapshotId}
 */
export async function pollSnapshot(snapshotId: string): Promise<BrightDataSnapshotStatus> {
  const token = await requireToken();
  const url = `${BD_BASE}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`;

  const res = await fetch(url, {
    headers: bearerHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Bright Data progress poll failed HTTP ${res.status}`);
  }

  const data = await res.json() as { status?: string };
  return (data.status ?? 'collecting') as BrightDataSnapshotStatus;
}

/**
 * Fetch results once snapshot is ready.
 * GET /datasets/v3/snapshot/{snapshotId}?format=json
 */
export async function fetchSnapshotResults(
  snapshotId: string,
): Promise<Record<string, unknown>[]> {
  const token = await requireToken();
  const url = `${BD_BASE}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`;

  const res = await fetch(url, {
    headers: bearerHeaders(token),
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Bright Data snapshot fetch failed HTTP ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Max poll iterations (1.5 s each) before timing out */
const MAX_POLL_ITERS = 60; // 90 s total

/**
 * Full trigger → poll → fetch cycle.
 * Use this for typical production flows; handles the async wait internally.
 */
export async function triggerAndFetch(
  datasetId: string,
  inputs: Record<string, unknown>[],
  opts: BrightDataTriggerOptions = {},
): Promise<Record<string, unknown>[]> {
  const { snapshotId } = await triggerCollection(datasetId, inputs, opts);

  for (let i = 0; i < MAX_POLL_ITERS; i++) {
    await sleep(1500);
    const status = await pollSnapshot(snapshotId);

    if (status === 'ready') {
      return fetchSnapshotResults(snapshotId);
    }
    if (status === 'failed') {
      throw new Error(`Bright Data snapshot ${snapshotId} failed`);
    }
    // 'collecting' | 'digesting' → keep polling
  }

  throw new Error(`Bright Data snapshot ${snapshotId} timed out after ${MAX_POLL_ITERS * 1.5}s`);
}

/**
 * Synchronous scrape path (≤20 URLs, real-time).
 * POST /datasets/v3/scrape?dataset_id={id}&format=json
 */
export async function syncScrape(
  datasetId: string,
  inputs: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const token = await requireToken();
  const url = `${BD_BASE}/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: bearerHeaders(token),
    body: JSON.stringify(inputs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bright Data sync scrape failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}
