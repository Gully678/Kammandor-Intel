/**
 * KINTEL Phase 3 — MoE Router unit tests
 *
 * Key-free: all provider calls are faked via vi.mock.
 * These tests run in under 1s (vitest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── policy tests (pure functions, no mocking needed) ────────────────────────

import { tierForTask, providersForTier, matrixForTier } from '../policy';

describe('tierForTask', () => {
  it('extract → fast', () => {
    expect(tierForTask('extract')).toBe('fast');
  });

  it('classify → fast', () => {
    expect(tierForTask('classify')).toBe('fast');
  });

  it('summarize → fast', () => {
    expect(tierForTask('summarize')).toBe('fast');
  });

  it('analyze → balanced', () => {
    expect(tierForTask('analyze')).toBe('balanced');
  });

  it('correlate → balanced', () => {
    expect(tierForTask('correlate')).toBe('balanced');
  });

  it('synthesize → critical', () => {
    expect(tierForTask('synthesize')).toBe('critical');
  });

  it('dossier → critical', () => {
    expect(tierForTask('dossier')).toBe('critical');
  });

  it('critical → critical', () => {
    expect(tierForTask('critical')).toBe('critical');
  });

  it('unknown task defaults to balanced', () => {
    expect(tierForTask('whatever')).toBe('balanced');
  });
});

describe('model matrix', () => {
  it('fast primary is Gemma 4 via OpenRouter (open-weight)', () => {
    expect(matrixForTier('fast')[0]).toEqual({ provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it' });
  });

  it('balanced primary is GLM 5.2 via OpenRouter', () => {
    expect(matrixForTier('balanced')[0]).toEqual({ provider: 'openrouter', model: 'z-ai/glm-5.2' });
  });

  it('critical (interactive) leads with Opus 4.8, then Grok, then GLM', () => {
    const c = matrixForTier('critical');
    expect(c[0]).toEqual({ provider: 'anthropic', model: 'claude-opus-4-8' });
    expect(c[1].provider).toBe('xai');
    expect(c[2].provider).toBe('openrouter');
  });

  it('vision uses no Gemini (open-weight first)', () => {
    const providers = matrixForTier('vision').map((s) => s.provider);
    expect(providers).not.toContain('google');
    expect(matrixForTier('vision')[0]).toEqual({ provider: 'openrouter', model: 'minimax/minimax-m3' });
  });

  it('every tier includes an open-weight OpenRouter step (cost-floor safety net)', () => {
    for (const tier of ['fast', 'balanced', 'critical', 'vision'] as const) {
      const providers = matrixForTier(tier).map((s) => s.provider);
      expect(providers).toContain('openrouter');
    }
  });

  it('vision task maps to the vision tier', () => {
    expect(tierForTask('vision')).toBe('vision');
    expect(tierForTask('image')).toBe('vision');
  });

  it('providersForTier stays derivable (back-compat): critical[0] === anthropic', () => {
    expect(providersForTier('critical')[0]).toBe('anthropic');
  });
});

// ─── analyzeEntities — monkeypatch routeComplete ─────────────────────────────

// Mock the router module so no real provider calls occur (key-free)
vi.mock('../router', () => ({
  routeComplete: vi.fn(),
}));

import { routeComplete } from '../router';
import { analyzeEntities } from '../analyze';
import type { Entity, Link } from '@/lib/ontology/types';

describe('analyzeEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns proposedEdits and narrative; writes nothing', async () => {
    const fakeResponse = {
      text: JSON.stringify({
        narrative: 'Test narrative from fake LLM.',
        risk_updates: [
          {
            entity_id:     'ent-001',
            risk_score:    7.5,
            risk_category: 'high',
            rationale:     'Elevated exposure detected.',
          },
        ],
        proposed_links: [
          {
            source_entity_id: 'ent-001',
            target_entity_id: 'ent-002',
            type:             'isDirectorOf',
            rationale:        'Name match across filings.',
          },
        ],
      }),
      model:    'fake-model',
      provider: 'fake',
      tier:     'critical' as const,
    };

    vi.mocked(routeComplete).mockResolvedValue(fakeResponse);

    const entities: Entity[] = [
      {
        id:             'ent-001',
        tenant_id:      'tenant-test',
        type:           'company',
        canonical_name: 'Acme Corp',
        properties:     {},
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      },
      {
        id:             'ent-002',
        tenant_id:      'tenant-test',
        type:           'person',
        canonical_name: 'John Doe',
        properties:     {},
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      },
    ];

    const links: Link[] = [];

    const result = await analyzeEntities({
      tenantId:  'tenant-test',
      entities,
      links,
      objective: 'Assess ownership risk.',
    });

    // Must return narrative
    expect(result.narrative).toBe('Test narrative from fake LLM.');

    // Must return proposedEdits (1 update + 1 link)
    expect(result.proposedEdits).toHaveLength(2);

    // All proposed edits must be pending (never writes directly)
    for (const edit of result.proposedEdits) {
      expect(edit.status).toBe('pending');
    }

    // Risk update proposal
    const riskEdit = result.proposedEdits.find(e => e.kind === 'update_entity');
    expect(riskEdit).toBeDefined();
    expect((riskEdit!.payload as Record<string, unknown>).patch).toMatchObject({
      risk_score:    7.5,
      risk_category: 'high',
    });

    // Link proposal
    const linkEdit = result.proposedEdits.find(e => e.kind === 'create_link');
    expect(linkEdit).toBeDefined();

    // routeComplete was called with task:'synthesize'
    expect(routeComplete).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'synthesize' }),
    );
  });

  it('gracefully handles unparseable LLM output', async () => {
    vi.mocked(routeComplete).mockResolvedValue({
      text:     'Some free-text response that is not JSON.',
      model:    'fake-model',
      provider: 'fake',
      tier:     'critical' as const,
    });

    const result = await analyzeEntities({
      tenantId:  'tenant-test',
      entities:  [],
      links:     [],
      objective: 'Test fallback.',
    });

    // Should still return a narrative (the raw text)
    expect(typeof result.narrative).toBe('string');
    expect(result.narrative.length).toBeGreaterThan(0);
    // No proposed edits from unparseable output
    expect(result.proposedEdits).toHaveLength(0);
  });
});
