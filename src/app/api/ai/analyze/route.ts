/**
 * ═══════════════════════════════════════════════════════════════
 *  KINTEL — AI Intelligence Analysis Endpoint  (Phase 3 rewrite)
 *  POST /api/ai/analyze
 *  Rate-limited; delegates to MoE router (no direct Gemini usage).
 *  Returns 422 "AI not configured" when no provider key is set.
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeIntelligence, type IntelligenceContext } from '@/lib/ai-engine';

export const dynamic = 'force-dynamic';

/* ─────────────────────────────────────────────────────────────
   Rate Limiter — 5 requests per minute per IP
   ───────────────────────────────────────────────────────────── */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetIn: entry.resetAt - now };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 120_000);

/* ─────────────────────────────────────────────────────────────
   Request / Response types
   ───────────────────────────────────────────────────────────── */

interface AnalyzeRequestBody {
  query:   string;
  context: IntelligenceContext;
}

interface AnalyzeResponse {
  analysis:  string;
  model:     string;
  timestamp: string;
}

interface ErrorResponse {
  error:        string;
  code:         string;
  retryAfter?:  number;
}

/* ─────────────────────────────────────────────────────────────
   POST Handler
   ───────────────────────────────────────────────────────────── */

export async function POST(
  request: NextRequest,
): Promise<NextResponse<AnalyzeResponse | ErrorResponse>> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Maximum 5 requests per minute.',
        code:  'RATE_LIMITED',
        retryAfter: Math.ceil(rateCheck.resetIn / 1000),
      },
      {
        status:  429,
        headers: {
          'Retry-After':           String(Math.ceil(rateCheck.resetIn / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(Math.ceil(rateCheck.resetIn / 1000)),
        },
      },
    );
  }

  let body: AnalyzeRequestBody;
  try {
    body = (await request.json()) as AnalyzeRequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body.', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  if (!body.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
    return NextResponse.json(
      { error: 'Query field is required and must be a non-empty string.', code: 'MISSING_QUERY' },
      { status: 400 },
    );
  }

  if (!body.context) {
    return NextResponse.json(
      { error: 'Intelligence context is required.', code: 'MISSING_CONTEXT' },
      { status: 400 },
    );
  }

  try {
    // _client is null — ai-engine now ignores it and delegates to the MoE router
    const analysis = await analyzeIntelligence(null, body.context, body.query.trim());

    return NextResponse.json(
      {
        analysis,
        model:     'moe-router',   // resolved model is inside the narrative; provider picked dynamically
        timestamp: new Date().toISOString(),
      },
      {
        headers: { 'X-RateLimit-Remaining': String(rateCheck.remaining) },
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    // MoE router exhausted all providers — no key configured
    if (message.includes('All providers failed') || message.includes('not configured')) {
      return NextResponse.json(
        {
          error: 'AI not configured. Set at least one provider key: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or ZHIPU_API_KEY.',
          code:  'AI_NOT_CONFIGURED',
        },
        { status: 422 },
      );
    }

    console.error('[KINTEL AI] Analysis error:', message);
    return NextResponse.json(
      { error: 'Intelligence analysis failed. Please try again.', code: 'ANALYSIS_FAILED' },
      { status: 500 },
    );
  }
}
