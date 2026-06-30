/**
 * KINTEL Phase 2 — Governed write proposals
 *
 * Governance boundary: these functions build ProposedEdit payloads only.
 * No DB writes occur here. A human must approve before application.
 *
 * Flow:
 *   1. LLM / agent calls proposeCreate* / proposeUpdate to construct a ProposedEdit.
 *   2. Caller persists the ProposedEdit to intel.proposed_edit (status='pending').
 *   3. Human reviewer approves (status→'approved') or rejects (status→'rejected').
 *   4. Application-layer job reads approved rows, applies them to intel.entity /
 *      intel.link, then sets status→'applied'.
 */

import type { Entity, Link, ProposedEdit } from './types';

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function newId(): string {
  // crypto.randomUUID() is available in Node 14.17+, Deno, and modern browsers.
  // Falls back to a time-based stub in environments that lack it.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Minimal fallback (not cryptographically safe — for test/SSR environments only)
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ProposedEdit for creating a new entity.
 * Does NOT write to the database.
 */
export function proposeCreateEntity(
  tenantId:   string,
  entity:     Omit<Entity, 'id' | 'created_at' | 'updated_at'>,
  proposedBy: string,
  rationale:  string,
): ProposedEdit {
  return {
    id:          newId(),
    tenant_id:   tenantId,
    kind:        'create_entity',
    payload:     entity as Record<string, unknown>,
    proposed_by: proposedBy,
    rationale,
    status:      'pending',
    created_at:  now(),
  };
}

/**
 * Build a ProposedEdit for creating a new link between entities.
 * Does NOT write to the database.
 */
export function proposeCreateLink(
  tenantId:   string,
  link:       Omit<Link, 'id' | 'created_at'>,
  proposedBy: string,
  rationale:  string,
): ProposedEdit {
  return {
    id:          newId(),
    tenant_id:   tenantId,
    kind:        'create_link',
    payload:     link as Record<string, unknown>,
    proposed_by: proposedBy,
    rationale,
    status:      'pending',
    created_at:  now(),
  };
}

/**
 * Build a ProposedEdit for a partial update to an existing entity or link.
 * Does NOT write to the database.
 */
export function proposeUpdate(
  tenantId:   string,
  kind:       'update_entity' | 'update_link',
  id:         string,
  patch:      Record<string, unknown>,
  proposedBy: string,
  rationale:  string,
): ProposedEdit {
  return {
    id:          newId(),
    tenant_id:   tenantId,
    kind,
    payload:     { id, patch },
    proposed_by: proposedBy,
    rationale,
    status:      'pending',
    created_at:  now(),
  };
}
