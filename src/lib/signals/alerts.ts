/**
 * KINTEL v2 — MatchedSignal -> public.intelligence_alerts rows
 * (PRD v2.0 §9.5–9.6)
 *
 * PURE MODULE: no network, no DB. Produces exact insert rows for the
 * contracted alert sink public.intelligence_alerts (organization_id,
 * headline, detail, severity, source_url, status). The main Kammandor app's
 * cron composes daily briefings from these rows — this module NEVER touches
 * daily_briefings or the intel.* graph tables itself.
 */

import type { IntelligenceAlertRow, MatchedSignal, SignalEvent } from './types';

/** Hard cap on headline length (intelligence_alerts.headline contract). */
export const HEADLINE_MAX_LENGTH = 200;

/** How much of the event description is carried into the alert detail. */
const DESCRIPTION_EXCERPT_LENGTH = 280;

/** Truncate a title to the headline budget, marking the cut with an ellipsis. */
export function truncateHeadline(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= HEADLINE_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, HEADLINE_MAX_LENGTH - 1)}…`;
}

/**
 * Deterministic duplicate key for an event within a tenant:
 *   tenantId + '|' + (event.url ?? headline-form of event.title)
 *
 * The title fallback uses the same truncation as the stored headline so a
 * key computed from an incoming event always agrees with a key rebuilt from
 * an already-inserted alert row (source_url ?? headline). For titles within
 * the 200-character budget this is exactly tenantId + '|' + event.title.
 */
export function dedupeKey(tenantId: string, event: SignalEvent): string {
  return `${tenantId}|${event.url ?? truncateHeadline(event.title)}`;
}

/** Rebuild the dedupe key from an already-stored alert row. */
export function dedupeKeyFromStoredAlert(
  tenantId: string,
  row: { source_url?: string | null; headline?: string | null },
): string {
  return `${tenantId}|${row.source_url ?? row.headline ?? ''}`;
}

/**
 * Map matched signals to exact intelligence_alerts insert rows.
 * Engine-created alerts are ALWAYS status 'open'; severity passes through
 * unchanged from the deterministic classifier (never re-derived here).
 */
export function toAlertRows(
  tenantId: string,
  signals: MatchedSignal[],
): IntelligenceAlertRow[] {
  return signals.map((signal) => {
    const { event } = signal;

    const detailParts: string[] = [signal.rationale];
    const description = event.description?.trim();
    if (description) {
      detailParts.push(
        description.length > DESCRIPTION_EXCERPT_LENGTH
          ? `${description.slice(0, DESCRIPTION_EXCERPT_LENGTH - 1)}…`
          : description,
      );
    }
    detailParts.push(`Source: ${event.sourceKey}`);

    return {
      organization_id: tenantId,
      headline: truncateHeadline(event.title),
      detail: detailParts.join('\n\n'),
      severity: signal.severity,
      source_url: event.url ?? null,
      status: 'open' as const,
    };
  });
}
