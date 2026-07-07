'use client';

/**
 * KINTEL — Free-tier live-metrics band (the "shop window").
 *
 * Self-contained: fetches GET /api/metrics/public on mount and every 60s,
 * renders an on-brand KPI band + a rotating single-line ticker + CTA, visible
 * WITHOUT auth. Zero coupling to page.tsx internals — mounts with a single
 * <LiveMetricsBand/>. Uses the brand CSS vars (--ink/--gold/--live/…) so it
 * matches whichever skin (Kammandor/INVRT) is active.
 *
 * GOVERNANCE: displays only the aggregate counts the API returns — labelled
 * live telemetry, never governed facts, never tenant data. If the endpoint is
 * unreachable the band self-hides (never shows a fake number).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface PublicMetrics {
  label: string;
  generated_at: string;
  registry: { sources_monitored: number; map_layers: number; governed_sources: number; basis: string };
  live: Record<string, number>;
  monitored_entities: number;
  cta: string;
}

const LIVE_LABELS: Record<string, string> = {
  flights_tracked: 'Aircraft tracked',
  earthquakes_24h: 'Earthquakes 24h',
  vessels_tracked: 'Vessels tracked',
  active_conflict_events: 'Conflict events',
  active_warzones: 'Active warzones',
  cyber_known_exploited: 'Known-exploited CVEs',
  news_items_24h: 'News items 24h',
  sanctions_entities: 'Sanctions entities',
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function LiveMetricsBand() {
  const [data, setData] = useState<PublicMetrics | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/metrics/public', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as PublicMetrics;
      if (json && typeof json.monitored_entities === 'number') setData(json);
    } catch {
      /* silent: band self-hides rather than showing a fake figure */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Rotating ticker index
  const tickerItems = useMemo(() => {
    if (!data) return [] as { label: string; value: number }[];
    return Object.entries(data.live)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ label: LIVE_LABELS[k] ?? k, value: v }));
  }, [data]);

  useEffect(() => {
    if (tickerItems.length === 0) return;
    const id = setInterval(() => setTick((t) => (t + 1) % tickerItems.length), 3_000);
    return () => clearInterval(id);
  }, [tickerItems.length]);

  if (!data || dismissed) return null;

  // Headline KPI tiles: the four that best prove breadth + liveness.
  const tiles: { label: string; value: string; accent?: boolean }[] = [
    { label: 'Sources monitored', value: String(data.registry.sources_monitored) },
    { label: 'Governed sources', value: String(data.registry.governed_sources) },
    { label: 'Map layers', value: String(data.registry.map_layers) },
    { label: 'Monitored entities', value: compact(data.monitored_entities), accent: true },
  ];

  const current = tickerItems[tick];

  return (
    <div
      className="lmb-root"
      style={{
        position: 'fixed',
        top: 34,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        maxWidth: '96vw',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'color-mix(in srgb, var(--ink) 88%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 40%, transparent)',
          borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.32)',
          backdropFilter: 'blur(8px)',
          color: 'var(--on-ink)',
          padding: '8px 10px',
          fontFamily: 'inherit',
        }}
      >
        {/* Header row: LIVE dot + label + dismiss */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--live)',
              boxShadow: '0 0 0 3px color-mix(in srgb, var(--live) 30%, transparent)',
              animation: 'lmbPulse 2s ease-in-out infinite',
            }}
          />
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.75 }}>
            Live intelligence · free layer
          </span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss live metrics"
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              color: 'var(--on-ink)',
              opacity: 0.55,
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>

        {/* KPI tiles */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {tiles.map((t) => (
            <div
              key={t.label}
              style={{
                minWidth: 92,
                textAlign: 'center',
                padding: '6px 12px',
                borderRadius: 8,
                background: t.accent
                  ? 'color-mix(in srgb, var(--gold) 18%, transparent)'
                  : 'color-mix(in srgb, var(--on-ink) 6%, transparent)',
                border: t.accent
                  ? '1px solid color-mix(in srgb, var(--gold) 55%, transparent)'
                  : '1px solid color-mix(in srgb, var(--on-ink) 12%, transparent)',
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: t.accent ? 'var(--gold)' : 'var(--on-ink)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {t.value}
              </div>
              <div style={{ fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7, marginTop: 2 }}>
                {t.label}
              </div>
            </div>
          ))}
        </div>

        {/* Rotating ticker */}
        {current && (
          <div
            style={{
              marginTop: 8,
              textAlign: 'center',
              fontSize: 11,
              opacity: 0.9,
              fontVariantNumeric: 'tabular-nums',
              minHeight: 16,
            }}
          >
            <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{current.value.toLocaleString()}</span>{' '}
            <span style={{ opacity: 0.8 }}>{current.label}</span>{' '}
            <span style={{ opacity: 0.4 }}>· live now</span>
          </div>
        )}

        {/* CTA */}
        <div style={{ marginTop: 6, textAlign: 'center' }}>
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            Unlock customised entity tracking + real-time alerts for your deals &amp; brands →
          </span>
        </div>
      </div>

      <style>{`
        @keyframes lmbPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
        @media (max-width: 640px) {
          .lmb-root { top: auto !important; bottom: 8px; }
        }
      `}</style>
    </div>
  );
}
