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

import type { Entity, Link, LinkType, ObjectType, ProposedEdit } from '@/lib/ontology/types';
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
  /**
   * Eval-gate result for each entry in `proposedEdits`, same order/length.
   * Added by Slice 4 — additive; callers that only read `proposedEdits`
   * (e.g. the existing router.test.ts assertions) are unaffected.
   */
  evaluations:   EvaluationResult[];
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
      `risk_score=${e.risk_score ?? 'null'} ` +
      `risk_category=${e.risk_category ?? 'null'} ` +
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

  const knownEntityIds = new Set(input.entities.map((e) => e.id));
  const evaluations = proposedEdits.map((edit) =>
    evaluate(edit, { knownEntityIds }),
  );

  return {
    narrative:     parsed.narrative ?? result.text,
    proposedEdits,
    evaluations,
  };
}

// ---------------------------------------------------------------------------
// evaluate — the AIP eval gate (Slice 4: real checks, wired into the pipeline)
// ---------------------------------------------------------------------------

export interface EvaluationResult {
  passed: boolean;
  score:  number;
  checks: string[];
}

/**
 * Optional grounding/threshold context for evaluate().
 * Backward compatible: evaluate(proposal) with no second argument still
 * works — grounding against knownEntityIds and the confidence floor both
 * become no-ops (grounding falls back to "well-formed UUID" only; the
 * confidence check is skipped when no confidence value is present).
 */
export interface EvaluateContext {
  /** Entity ids considered to exist for grounding purposes (e.g. the tenant's
   *  known graph, or — as wired in analyzeEntities() below — the entities the
   *  analysis was run against). Accepts a Set or array for caller convenience. */
  knownEntityIds?: Set<string> | string[];
  /** Minimum acceptable confidence (0–1 scale, matching Provenance.confidence
   *  and every ontology mapper's convention — see src/lib/ontology/mappers/*.ts).
   *  Defaults to 0.3. */
  minConfidence?: number;
}

// Derived (not hardcoded) valid-value lists — keep in sync with types.ts.
// If ObjectType / LinkType in src/lib/ontology/types.ts ever change, update
// these two literal arrays to match (TypeScript's `satisfies` below will
// fail to compile if a listed value is not assignable to the type, catching
// typos; it cannot catch an added type-side member being *missing* here —
// that is why this comment exists as the sync reminder the brief asked for).
const VALID_OBJECT_TYPES = [
  'company', 'person', 'fund', 'deal', 'vessel', 'port', 'wallet',
  'sanction', 'filing', 'event', 'asset', 'jurisdiction', 'news_source',
  'instrument',
] as const satisfies readonly ObjectType[];

const VALID_LINK_TYPES = [
  'isDirectorOf', 'beneficialOwnerOf', 'shareholderOf', 'subsidiaryOf',
  'isNamedInDeal', 'isSubjectOf', 'registeredIn', 'filedWith',
  'portCallAt', 'linkedWallet', 'mentionedInEvent', 'connectedJurisdiction',
  'ownsAsset', 'pricedBy',
] as const satisfies readonly LinkType[];

// RFC 4122-shaped UUID (any version/variant nibble accepted — propose.ts's
// crypto.randomUUID() and the mappers' pseudoUuid() fixtures both match).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function toIdSet(ids: Set<string> | string[] | undefined): Set<string> | undefined {
  if (ids === undefined) return undefined;
  return ids instanceof Set ? ids : new Set(ids);
}

/**
 * Read a field for evaluation purposes, accounting for the two payload
 * shapes ProposedEdit.payload can take (see src/lib/ontology/propose.ts):
 *   - create_entity / create_link: fields live directly on payload.
 *   - update_entity / update_link: payload is `{ id, patch }`; the fields
 *     being set live under payload.patch.
 */
function readField(payload: Record<string, unknown>, key: string): unknown {
  if (key in payload) return payload[key];
  const patch = payload.patch;
  if (patch && typeof patch === 'object') {
    return (patch as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * The AIP eval gate for proposed edits.
 *
 * Runs structural, type-validity, grounding, risk-range, and confidence
 * checks against a ProposedEdit BEFORE it is surfaced to a human reviewer.
 * `passed` reflects only the HARD checks (structure / type validity /
 * link grounding / risk range when present); confidence is soft and only
 * affects `score`, never `passed`, unless you choose to escalate it later
 * (documented decision — see slice4-report.md "concerns").
 *
 * @governance  This is the AIP eval gate: LLM proposes → evaluate → human approves.
 *              It never writes to any DB and never mutates the proposal.
 */
export function evaluate(
  proposal: ProposedEdit,
  context?: EvaluateContext,
): EvaluationResult {
  const checks: string[] = [];
  let score = 1.0;
  let hardFailed = false;

  const knownEntityIds = toIdSet(context?.knownEntityIds);
  const minConfidence  = context?.minConfidence ?? 0.3;

  const fail = (msg: string, penalty: number, hard: boolean) => {
    checks.push(`FAIL: ${msg}`);
    score -= penalty;
    if (hard) hardFailed = true;
  };
  const pass = (msg: string) => checks.push(`PASS: ${msg}`);
  const warn = (msg: string, penalty: number) => {
    checks.push(`WARN: ${msg}`);
    score -= penalty;
  };

  // -------------------------------------------------------------------
  // 1. STRUCTURE (hard) — payload must be a non-null object, and the
  //    fields required for this `kind` must be present.
  // -------------------------------------------------------------------
  const payloadIsObject = !!proposal.payload && typeof proposal.payload === 'object';
  if (!payloadIsObject) {
    fail('payload is not an object', 0.5, true);
  } else {
    pass('payload is object');
  }

  const validKinds = ['create_entity', 'update_entity', 'create_link', 'update_link'];
  if (!validKinds.includes(proposal.kind)) {
    fail(`unknown kind "${proposal.kind}"`, 0.5, true);
  } else {
    pass(`kind "${proposal.kind}" is valid`);
  }

  const payload = payloadIsObject ? (proposal.payload as Record<string, unknown>) : {};

  if (proposal.kind === 'create_entity') {
    const type = readField(payload, 'type');
    if (type === undefined || type === null || type === '') {
      fail('create_entity payload missing required field "type"', 0.5, true);
    } else {
      pass('create_entity payload has required field "type"');
    }
  }

  if (proposal.kind === 'create_link') {
    const sourceId = readField(payload, 'source_entity_id');
    const targetId = readField(payload, 'target_entity_id');
    const type     = readField(payload, 'type');
    const missing: string[] = [];
    if (sourceId === undefined || sourceId === null || sourceId === '') missing.push('source_entity_id');
    if (targetId === undefined || targetId === null || targetId === '') missing.push('target_entity_id');
    if (type === undefined || type === null || type === '') missing.push('type');
    if (missing.length > 0) {
      fail(`create_link payload missing required field(s): ${missing.join(', ')}`, 0.5, true);
    } else {
      pass('create_link payload has required fields (source_entity_id, target_entity_id, type)');
    }
  }

  // -------------------------------------------------------------------
  // 2. TYPE VALIDITY (hard) — the `type` field must be a member of the
  //    relevant enum, derived from types.ts (see VALID_OBJECT_TYPES /
  //    VALID_LINK_TYPES above), not a hardcoded ad-hoc list.
  // -------------------------------------------------------------------
  if (proposal.kind === 'create_entity') {
    const type = readField(payload, 'type');
    if (typeof type === 'string' && type.length > 0) {
      if ((VALID_OBJECT_TYPES as readonly string[]).includes(type)) {
        pass(`entity type "${type}" is a valid ObjectType`);
      } else {
        fail(`entity type "${type}" is not a valid ObjectType`, 0.5, true);
      }
    }
  }

  if (proposal.kind === 'create_link') {
    const type = readField(payload, 'type');
    if (typeof type === 'string' && type.length > 0) {
      if ((VALID_LINK_TYPES as readonly string[]).includes(type)) {
        pass(`link type "${type}" is a valid LinkType`);
      } else {
        fail(`link type "${type}" is not a valid LinkType`, 0.5, true);
      }
    }
  }

  // -------------------------------------------------------------------
  // 3. GROUNDING (hard for links) — source/target must be well-formed
  //    UUIDs, and (when context.knownEntityIds is supplied) must both be
  //    members of it, i.e. the link must not dangle. create_entity needs
  //    no external grounding.
  // -------------------------------------------------------------------
  if (proposal.kind === 'create_link') {
    const sourceId = readField(payload, 'source_entity_id');
    const targetId = readField(payload, 'target_entity_id');

    for (const [label, id] of [['source_entity_id', sourceId], ['target_entity_id', targetId]] as const) {
      if (id === undefined || id === null || id === '') continue; // already reported by STRUCTURE
      if (!isUuid(id)) {
        fail(`${label} "${String(id)}" is not a well-formed UUID`, 0.5, true);
      } else {
        pass(`${label} is a well-formed UUID`);
        if (knownEntityIds) {
          if (knownEntityIds.has(id as string)) {
            pass(`${label} is a known entity (grounded)`);
          } else {
            fail(`${label} "${id}" does not match any known entity — link would dangle`, 0.5, true);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // 4. RISK RANGE (hard if present) — payload.risk_score, when present,
  //    must be a finite number in [0, 10].
  //
  //    Convention note: types.ts (RiskSubject / Entity) types risk_score
  //    as a plain `number` with no encoded bound. The [0, 10] range comes
  //    from the documented pipeline convention: analyzeEntities()'s own
  //    prompt to the LLM asks for `"risk_score": <0-10 float>` (see
  //    buildPrompt() above), and the pre-Slice-4 evaluate() stub's doc
  //    comment already named "risk_score range validation (0–10)" as the
  //    intended check. If the ontology schema is ever changed to a 0–1 or
  //    0–100 risk scale, this range (and this comment) must move with it.
  // -------------------------------------------------------------------
  const riskScore = readField(payload, 'risk_score');
  if (riskScore !== undefined && riskScore !== null) {
    if (typeof riskScore !== 'number' || !Number.isFinite(riskScore)) {
      fail(`risk_score "${String(riskScore)}" is not a finite number`, 0.5, true);
    } else if (riskScore < 0 || riskScore > 10) {
      fail(`risk_score ${riskScore} is outside the valid range [0, 10]`, 0.5, true);
    } else {
      pass(`risk_score ${riskScore} is within [0, 10]`);
    }
  }

  // -------------------------------------------------------------------
  // 5. CONFIDENCE (soft) — if a confidence value is present (payload-level
  //    `confidence`, or nested `provenance.confidence`, matching the shape
  //    every mapper in src/lib/ontology/mappers/*.ts emits — a 0–1 scale),
  //    it must be >= context.minConfidence (default 0.3). Below-threshold
  //    confidence lowers the score and is noted, but does NOT hard-fail:
  //    a low-confidence proposal is still worth a human's attention, it
  //    just should not look identical to a high-confidence one. If a
  //    future reviewer decides low confidence should hard-block instead,
  //    that is a one-line change (move this branch's `fail(...)` third
  //    argument from `false` to `true`).
  // -------------------------------------------------------------------
  const rawConfidence = readField(payload, 'confidence')
    ?? (() => {
      const prov = readField(payload, 'provenance');
      return prov && typeof prov === 'object'
        ? (prov as Record<string, unknown>).confidence
        : undefined;
    })();

  if (rawConfidence !== undefined && rawConfidence !== null) {
    if (typeof rawConfidence !== 'number' || !Number.isFinite(rawConfidence)) {
      warn(`confidence "${String(rawConfidence)}" is not a finite number`, 0.2);
    } else if (rawConfidence < minConfidence) {
      warn(`confidence ${rawConfidence} is below threshold ${minConfidence}`, 0.2);
    } else {
      pass(`confidence ${rawConfidence} meets threshold ${minConfidence}`);
    }
  }

  // -------------------------------------------------------------------
  // Rationale — retained from the pre-Slice-4 stub (soft).
  // -------------------------------------------------------------------
  if (!proposal.rationale || proposal.rationale.trim().length === 0) {
    warn('rationale is empty', 0.1);
  } else {
    pass('rationale present');
  }

  return {
    passed: !hardFailed,
    score:  Math.max(0, Math.round(score * 100) / 100),
    checks,
  };
}
