/**
 * KINTEL Phase 3 — Governed ontology analysis
 *
 * analyzeEntities() builds a structured prompt from typed ontology objects
 * and calls routeComplete({task:'synthesize'}).  It NEVER writes to any DB.
 * It returns proposed edits built via propose.ts.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  AIP GOVERNANCE BOUNDARY                                            │
 * │                                                                     │
 * │  LLM output arrives as freeform text here.                         │
 * │  We parse it into ProposedEdit objects (all status='pending').      │
 * │  These are returned to the CALLER, never directly persisted.        │
 * │                                                                     │
 * │  Flow:  LLM proposes → evaluate() gate → human approves            │
 * │         → application layer applies to intel.entity / intel.link   │
 * │                                                                     │
 * │  Nothing in this file touches Supabase or any database client.     │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import type { Entity, Link, ProposedEdit } from '@/lib/ontology/types';
import { proposeUpdate, proposeCreateLink } from '@/lib/ontology/propose';
import { routeComplete } from './router';

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

export interface AnalyzeEntitiesInput {
  tenantId:  string;
  entities:  Entity[];
  links:     Link[];
  objective: string;
}

export interface AnalyzeEntitiesResult {
  narrative:     string;
  proposedEdits: ProposedEdit[];
}

// ---------------------------------------------------------------------------
// Prompt builder — structured, no raw web text
// ---------------------------------------------------------------------------

function buildPrompt(input: AnalyzeEntitiesInput): string {
  const lines: string[] = [];

  lines.push(`## OBJECTIVE\n${input.objective}`);

  lines.push(`\n## ENTITIES (${input.entities.length})`);
  for (const e of input.entities) {
    const props = JSON.stringify(e.properties ?? {});
    lines.push(
      `  [${e.id}] type=${e.type} name="${e.canonical_name ?? '(unnamed)'}" ` +
      `risk_score=${(e as Record<string, unknown>).risk_score ?? 'null'} ` +
      `risk_category=${(e as Record<string, unknown>).risk_category ?? 'null'} ` +
      `props=${props}`
    );
  }

  lines.push(`\n## LINKS (${input.links.length})`);
  for (const l of input.links) {
    lines.push(
      `  [${l.id}] ${l.source_entity_id} --[${l.type}]--> ${l.target_entity_id} ` +
      `strength=${l.strength ?? 'null'}`
    );
  }

  lines.push(`
## ANALYST INSTRUCTIONS
Analyse the entity graph above in the context of the objective.
Return a JSON object with exactly these keys:
{
  "narrative": "<concise intelligence narrative, 3-5 sentences>",
  "risk_updates": [
    { "entity_id": "<id>", "risk_score": <0-10 float>, "risk_category": "<low|medium|high|critical>", "rationale": "<1 sentence>" }
  ],
  "proposed_links": [
    { "source_entity_id": "<id>", "target_entity_id": "<id>", "type": "<LinkType>", "rationale": "<1 sentence>" }
  ]
}
Output ONLY the JSON object. No markdown fences, no preamble.`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON parser — defensive
// ---------------------------------------------------------------------------

interface LLMAnalysisOutput {
  narrative?:       string;
  risk_updates?:    Array<{
    entity_id:     string;
    risk_score:    number;
    risk_category: string;
    rationale:     string;
  }>;
  proposed_links?: Array<{
    source_entity_id: string;
    target_entity_id: string;
    type:             string;
    rationale:        string;
  }>;
}

function parseOutput(text: string): LLMAnalysisOutput {
  // Strip markdown fences if the model ignored instructions
  const stripped = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(stripped) as LLMAnalysisOutput;
  } catch {
    // Partial fallback: return narrative only
    return { narrative: text };
  }
}

// ---------------------------------------------------------------------------
// analyzeEntities — governed analysis, no DB writes
// ---------------------------------------------------------------------------

/**
 * Analyse a set of typed ontology objects against an objective.
 *
 * Returns a narrative + zero or more ProposedEdits (all status='pending').
 * The CALLER is responsible for persisting proposed edits through the
 * human-approval workflow before they are applied.
 *
 * @governance  AIP boundary — LLM proposes only; no writes occur here.
 */
export async function analyzeEntities(
  input: AnalyzeEntitiesInput,
): Promise<AnalyzeEntitiesResult> {
  const prompt = buildPrompt(input);

  const result = await routeComplete({
    task:      'synthesize',
    system:    'You are a KINTEL intelligence analyst. Respond with structured JSON only.',
    prompt,
    maxTokens: 1024,
  });

  const parsed = parseOutput(result.text);

  const proposedEdits: ProposedEdit[] = [];

  // Risk score / category updates → proposeUpdate
  for (const update of parsed.risk_updates ?? []) {
    const edit = proposeUpdate(
      input.tenantId,
      'update_entity',
      update.entity_id,
      {
        risk_score:    update.risk_score,
        risk_category: update.risk_category,
      },
      'ai-moe-analyzer',
      update.rationale,
    );
    proposedEdits.push(edit);
  }

  // Proposed new links → proposeCreateLink
  for (const pl of parsed.proposed_links ?? []) {
    const linkEdit = proposeCreateLink(
      input.tenantId,
      {
        tenant_id:        input.tenantId,
        source_entity_id: pl.source_entity_id,
        target_entity_id: pl.target_entity_id,
        type:             pl.type as import('@/lib/ontology/types').LinkType,
        strength:         null,
        properties:       {},
      },
      'ai-moe-analyzer',
      pl.rationale,
    );
    proposedEdits.push(linkEdit);
  }

  return {
    narrative:     parsed.narrative ?? result.text,
    proposedEdits,
  };
}

// ---------------------------------------------------------------------------
// evaluate — eval gate stub (Phase 4 / human-in-loop expansion)
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  passed: boolean;
  score:  number;
  checks: string[];
}

/**
 * Stub evaluation gate for proposed edits.
 * Phase 4 will implement:
 *   - grounding check (entity ids exist in tenant)
 *   - risk_score range validation (0–10)
 *   - link type validity (LinkType enum)
 *   - confidence threshold
 *
 * @governance  This is the AIP eval gate: LLM proposes → evaluate → human approves.
 */
export function evaluate(proposal: ProposedEdit): EvaluationResult {
  const checks: string[] = [];
  let score = 1.0;

  // Format check: payload must be a non-null object
  if (!proposal.payload || typeof proposal.payload !== 'object') {
    checks.push('FAIL: payload is not an object');
    score -= 0.5;
  } else {
    checks.push('PASS: payload is object');
  }

  // Kind check: must be a known kind
  const validKinds = ['create_entity', 'update_entity', 'create_link', 'update_link'];
  if (!validKinds.includes(proposal.kind)) {
    checks.push(`FAIL: unknown kind "${proposal.kind}"`);
    score -= 0.5;
  } else {
    checks.push(`PASS: kind "${proposal.kind}" is valid`);
  }

  // Rationale check: should be non-empty
  if (!proposal.rationale || proposal.rationale.trim().length === 0) {
    checks.push('WARN: rationale is empty');
    score -= 0.1;
  } else {
    checks.push('PASS: rationale present');
  }

  return {
    passed: score >= 0.5,
    score:  Math.max(0, Math.round(score * 100) / 100),
    checks,
  };
}
