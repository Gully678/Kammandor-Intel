/**
 * KINTEL — Worker Enqueue Endpoint
 * POST /api/ai/enqueue
 *
 * Thin forwarder: validates the body and forwards to the Python workers
 * service on Render (WORKER_URL env var).
 *
 * Returns 503 if WORKER_URL is not set — fail fast so callers know the
 * workers service is not connected yet.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface EnqueueBody {
  tenant: string;
  objective: string;
  entity_ids?: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const workerUrl = process.env.WORKER_URL;

  if (!workerUrl) {
    return NextResponse.json(
      { error: 'Worker service not configured. Set WORKER_URL env var.' },
      { status: 503 },
    );
  }

  let body: EnqueueBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.tenant || !body.objective) {
    return NextResponse.json(
      { error: 'tenant and objective are required.' },
      { status: 400 },
    );
  }

  const upstream = await fetch(`${workerUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id:  body.tenant,
      objective:  body.objective,
      entity_ids: body.entity_ids ?? [],
    }),
  });

  const data = await upstream.json();

  return NextResponse.json(data, { status: upstream.status });
}
