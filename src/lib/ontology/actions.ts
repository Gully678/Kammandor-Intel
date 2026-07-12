/**
 * Mission C — the kinetic ACTION layer (Palantir "systems of action"
 * write-back column), v1 draft.
 *
 * Pure TypeScript value types + the deterministic abstention router. No
 * network/DB dependency — this module mirrors the SQL shapes defined in
 * migrations/intel/0032_action_registry.sql (intel.action_type,
 * intel.action) exactly, the same way src/lib/ontology/types.ts mirrors
 * intel.entity / intel.link.
 *
 * The abstention-layer principle (see intel.action_type's table comment):
 *   - 'act'        — auto-execute: the engine may perform low-risk actions
 *                    without a human in the loop, subject to confidence.
 *   - 'draft'      — prepare & recommend: the engine builds the artefact/
 *                    payload, but a human must approve before it is sent.
 *   - 'ask_human'  — explicit human approval required, always, regardless
 *                    of confidence — the highest-risk / most consequential
 *                    tier.
 *
 * No LLM ever emits an unreviewed action: routeAction() is a pure,
 * deterministic function of (risk_tier, confidence) — never inference,
 * never a model call. Fail-closed: any confidence value outside [0, 1],
 * or NaN, is treated as the least-trusted signal and routed to
 * 'ask_human'.
 */

// ---------------------------------------------------------------------------
// Catalogue key + status unions (mirror the CHECK constraints in 0032)
// ---------------------------------------------------------------------------

/** Mirrors the 5 seed rows of intel.action_type (migration 0032). */
export type ActionTypeKey =
  | 'notify'
  | 'create_kammandor_task'
  | 'draft_pulse_asset'
  | 'attach_to_deal'
  | 'fire_webhook';

/** Mirrors intel.action_type.risk_tier CHECK constraint. */
export type RiskTier = 'act' | 'draft' | 'ask_human';

/** Mirrors intel.action.status CHECK constraint. */
export type ActionStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'failed'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Row shapes (mirror SQL columns — pure value types, no runtime DB coupling)
// ---------------------------------------------------------------------------

/** Mirrors intel.action_type (migration 0032). Platform catalogue, not tenant-scoped. */
export interface ActionType {
  key: ActionTypeKey;
  label: string;
  description: string;
  risk_tier: RiskTier;
  enabled_by_default: boolean;
  created_at: string; // ISO 8601
}

/** Mirrors intel.action (migration 0032). Tenant-scoped write-back queue row. */
export interface Action {
  id: string;
  tenant_id: string;
  action_type_key: ActionTypeKey;
  subject_entity_id?: string | null;
  payload: Record<string, unknown>;
  status: ActionStatus;
  requested_by: string;
  rationale?: string | null;
  approved_by?: string | null;
  approved_at?: string | null; // ISO 8601
  executed_at?: string | null; // ISO 8601
  error?: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// The deterministic abstention router
// ---------------------------------------------------------------------------

/** Confidence must be a finite number in [0, 1] to be trusted at all. */
function isValidConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

/**
 * routeAction — the DETERMINISTIC abstention router (never an LLM call).
 *
 * Given an action type's risk_tier and a caller-supplied confidence score,
 * decides whether the action should be auto-executed ('act'), prepared and
 * recommended for human review ('draft'), or require explicit human
 * approval before anything happens ('ask_human').
 *
 * Rules (fail-closed on any invalid confidence):
 *   - confidence outside [0, 1], or NaN => 'ask_human', regardless of tier.
 *   - risk_tier 'ask_human' => always 'ask_human' (confidence is irrelevant
 *     — the highest-risk tier never auto-escalates itself down).
 *   - risk_tier 'draft'     => confidence >= 0.9 ? 'draft' : 'ask_human'.
 *   - risk_tier 'act'       => confidence >= 0.9 ? 'act'
 *                              : confidence >= 0.6 ? 'draft'
 *                              : 'ask_human'.
 */
export function routeAction(riskTier: RiskTier, confidence: number): RiskTier {
  if (!isValidConfidence(confidence)) return 'ask_human';

  if (riskTier === 'ask_human') return 'ask_human';

  if (riskTier === 'draft') {
    return confidence >= 0.9 ? 'draft' : 'ask_human';
  }

  // riskTier === 'act'
  if (confidence >= 0.9) return 'act';
  if (confidence >= 0.6) return 'draft';
  return 'ask_human';
}

/**
 * initialStatusFor — maps a routeAction() outcome onto the initial
 * intel.action.status a new row should be inserted with:
 *   - 'act'                => 'queued' (the engine may proceed without a
 *     human gate — a later executor slice dequeues 'queued' rows).
 *   - 'draft' | 'ask_human' => 'awaiting_approval' (a human must call
 *     intel.approve_action() / intel.reject_action() first).
 *
 * Rows are NEVER inserted directly as 'approved' — see
 * src/app/api/ontology/actions/route.ts's governance banner and
 * migrations/intel/0032_action_registry.sql's governance boundary.
 */
export function initialStatusFor(route: RiskTier): ActionStatus {
  return route === 'act' ? 'queued' : 'awaiting_approval';
}
