'use client';

import * as React from 'react';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Layers,
  RotateCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';

/* ─────────────────────────── Types ─────────────────────────── */

type RenderMode = 'map-layer' | 'panel' | 'enrichment';
type Tier = 'free' | 'byok' | 'premium';

interface CoverageSource {
  key: string;
  category: string;
  render_mode: RenderMode;
  tier: Tier;
}

interface CoverageTool {
  [key: string]: unknown;
}

interface CoverageGovernance {
  sole_writer?: boolean;
  proposals_only?: boolean;
  sanctions_matches?: string | boolean;
  rls?: boolean;
}

interface CoverageResponse {
  schema_version?: string;
  engine?: string;
  governance?: CoverageGovernance;
  tools?: CoverageTool[];
  sources?: CoverageSource[];
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface CategoryGroup {
  category: string;
  sources: CoverageSource[];
}

/* ───────────────────────── Constants ───────────────────────── */

const RENDER_MODE_LABEL: Record<RenderMode, string> = {
  'map-layer': 'Map layer',
  panel: 'Panel',
  enrichment: 'Enrichment',
};

const TIER_LABEL: Record<Tier, string> = {
  free: 'Free',
  byok: 'BYOK',
  premium: 'Premium',
};

// Known acronyms that should render fully uppercased.
const ACRONYMS = new Set<string>([
  'ofac', 'sdn', 'sec', 'edgar', 'adsb', 'lol', 'faa', 'imo', 'ais',
  'un', 'eu', 'uk', 'us', 'usa', 'uae', 'icij', 'gleif', 'iata', 'api',
  'gdelt', 'noaa', 'usgs', 'fmp', 'esg', 'kyc', 'aml', 'pep', 'ubo',
  'rss', 'osm', 'nasa', 'cia', 'fbi', 'dea', 'hmt', 'ofsi', 'ba',
  'lei', 'isin', 'cusip', 'swift', 'iban', 'vat', 'gps', 'utc', 'id',
]);

const MONO =
  "'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SERIF = "'Instrument Serif', Georgia, serif";

/* ───────────────────────── Helpers ─────────────────────────── */

function humaniseKey(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      if (ACRONYMS.has(lower) || lower.length <= 3) {
        return token.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function humaniseCategory(category: string): string {
  return humaniseKey(category);
}

/* ─────────────────────── Sub-components ─────────────────────── */

function TierBadge({ tier }: { tier: Tier }): React.JSX.Element {
  const palette: Record<Tier, { bg: string; fg: string; border: string }> = {
    free: {
      bg: 'color-mix(in srgb, var(--live) 18%, transparent)',
      fg: 'var(--live)',
      border: 'color-mix(in srgb, var(--live) 45%, transparent)',
    },
    byok: {
      bg: 'color-mix(in srgb, var(--gold) 18%, transparent)',
      fg: 'var(--gold)',
      border: 'color-mix(in srgb, var(--gold) 45%, transparent)',
    },
    premium: {
      bg: 'color-mix(in srgb, var(--on-ink) 12%, transparent)',
      fg: 'var(--on-ink)',
      border: 'color-mix(in srgb, var(--on-ink) 30%, transparent)',
    },
  };
  const c = palette[tier];
  return (
    <span
      className="cvg-badge"
      style={{ background: c.bg, color: c.fg, borderColor: c.border }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

function ModeChip({ mode }: { mode: RenderMode }): React.JSX.Element {
  return (
    <span
      className="cvg-chip"
      title={RENDER_MODE_LABEL[mode]}
      data-mode={mode}
    >
      {mode === 'map-layer' && (
        <Layers size={10} strokeWidth={2.2} aria-hidden="true" />
      )}
      {RENDER_MODE_LABEL[mode]}
    </span>
  );
}

function SkeletonRows(): React.JSX.Element {
  const rows = Array.from({ length: 8 });
  return (
    <div aria-hidden="true" style={{ padding: '4px 18px 18px' }}>
      {rows.map((_, i) => (
        <div key={i} className="cvg-skeleton-row">
          <span className="cvg-shimmer" style={{ width: '46%', height: 13 }} />
          <span className="cvg-shimmer" style={{ width: 54, height: 13 }} />
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── Main component ─────────────────────── */

export default function CoveragePanel(): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<CoverageResponse | null>(null);
  const [query, setQuery] = useState<string>('');

  const searchRef = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  /* ── Data fetch (once, cached in state) ── */
  const load = useCallback(async (): Promise<void> => {
    setState('loading');
    try {
      const res = await fetch('/api/ai/tools', {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Coverage request failed (${res.status})`);
      }
      const json: CoverageResponse = await res.json();
      setData(json);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  const openDrawer = useCallback((): void => {
    setOpen(true);
    if (state === 'idle' || (state === 'error' && !data)) {
      void load();
    }
  }, [state, data, load]);

  const closeDrawer = useCallback((): void => {
    setOpen(false);
    // Restore focus to the launcher for keyboard users.
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  /* ── ESC to close + body scroll-lock ── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDrawer();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, closeDrawer]);

  /* ── Focus search on open ── */
  useEffect(() => {
    if (open && state === 'ready') {
      const t = window.setTimeout(() => searchRef.current?.focus(), 260);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, state]);

  /* ── Derived counts ── */
  const sources = useMemo<CoverageSource[]>(
    () => data?.sources ?? [],
    [data],
  );

  const { total, mapLayers, governed } = useMemo(() => {
    const t = sources.length;
    const ml = sources.filter((s) => s.render_mode === 'map-layer').length;
    return { total: t, mapLayers: ml, governed: t - ml };
  }, [sources]);

  /* ── Filter + group ── */
  const groups = useMemo<CategoryGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sources.filter(
          (s) =>
            s.key.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            humaniseKey(s.key).toLowerCase().includes(q),
        )
      : sources;

    const map = new Map<string, CoverageSource[]>();
    for (const s of filtered) {
      const arr = map.get(s.category);
      if (arr) arr.push(s);
      else map.set(s.category, [s]);
    }

    return Array.from(map.entries())
      .map(([category, list]) => ({
        category,
        sources: [...list].sort((a, b) =>
          humaniseKey(a.key).localeCompare(humaniseKey(b.key)),
        ),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [sources, query]);

  const filteredCount = useMemo(
    () => groups.reduce((acc, g) => acc + g.sources.length, 0),
    [groups],
  );

  const sanctionsNote =
    typeof data?.governance?.sanctions_matches === 'string'
      ? (data.governance.sanctions_matches as string)
      : 'Sanctions matches are HITL — never auto-actioned.';

  /* ── Click-outside ── */
  const onOverlayMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        closeDrawer();
      }
    },
    [closeDrawer],
  );

  /* ── Render ── */
  return (
    <>
      <style>{`
        .cvg-launcher {
          position: fixed;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          z-index: 35;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px 9px 16px 7px;
          border: 1px solid color-mix(in srgb, var(--gold) 35%, transparent);
          border-left: none;
          border-radius: 0 12px 12px 0;
          background: color-mix(in srgb, var(--ink) 90%, transparent);
          color: var(--on-ink);
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 34px rgba(0,0,0,.4);
          cursor: pointer;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-family: ${MONO};
          font-size: 10px;
          letter-spacing: .22em;
          text-transform: uppercase;
          transition: box-shadow .2s ease, border-color .2s ease, background .2s ease;
        }
        .cvg-launcher:hover,
        .cvg-launcher:focus-visible {
          outline: none;
          border-color: color-mix(in srgb, var(--gold) 60%, transparent);
          box-shadow: 0 3px 14px rgba(232,160,32,.28);
        }
        .cvg-launcher .cvg-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--live);
          box-shadow: 0 0 8px color-mix(in srgb, var(--live) 80%, transparent);
        }

        .cvg-overlay {
          position: fixed;
          inset: 0;
          z-index: 46;
          background: rgba(6,5,10,.42);
          backdrop-filter: blur(2px);
        }

        .cvg-drawer {
          position: fixed;
          top: 0;
          left: 0;
          bottom: 0;
          z-index: 46;
          width: 440px;
          max-width: 92vw;
          display: flex;
          flex-direction: column;
          background: color-mix(in srgb, var(--ink) 90%, transparent);
          border-right: 1px solid color-mix(in srgb, var(--gold) 35%, transparent);
          box-shadow: 0 10px 34px rgba(0,0,0,.4);
          backdrop-filter: blur(10px);
          color: var(--on-ink);
        }
        @media (max-width: 640px) {
          .cvg-drawer { width: 100vw; max-width: 100vw; }
        }

        .cvg-eyebrow {
          font-family: ${MONO};
          text-transform: uppercase;
          letter-spacing: .12em;
          font-size: 10px;
          color: var(--gold-text, var(--gold));
        }

        .cvg-header {
          padding: 22px 22px 16px;
          border-bottom: 1px solid color-mix(in srgb, var(--on-ink) 10%, transparent);
        }
        .cvg-title {
          font-family: ${SERIF};
          font-weight: 400;
          font-size: 30px;
          line-height: 1.05;
          margin: 6px 0 10px;
          color: var(--on-ink);
        }
        .cvg-counts {
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .cvg-count-main {
          font-family: ${MONO};
          font-size: 12px;
          letter-spacing: .04em;
          color: var(--on-ink);
          font-variant-numeric: tabular-nums;
        }
        .cvg-count-sub {
          font-family: ${MONO};
          font-size: 10px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }

        .cvg-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          border-radius: 8px;
          border: 1px solid color-mix(in srgb, var(--on-ink) 14%, transparent);
          background: transparent;
          color: var(--on-ink);
          cursor: pointer;
          transition: background .16s ease, border-color .16s ease;
        }
        .cvg-close:hover { background: color-mix(in srgb, var(--on-ink) 8%, transparent); }

        .cvg-search-wrap {
          position: relative;
          padding: 14px 22px 12px;
          border-bottom: 1px solid color-mix(in srgb, var(--on-ink) 10%, transparent);
        }
        .cvg-search {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px 10px 34px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--on-ink) 16%, transparent);
          background: color-mix(in srgb, var(--ink) 60%, transparent);
          color: var(--on-ink);
          font-family: ${MONO};
          font-size: 12px;
          letter-spacing: .04em;
          outline: none;
          transition: border-color .16s ease, box-shadow .16s ease;
        }
        .cvg-search::placeholder {
          color: color-mix(in srgb, var(--muted) 90%, transparent);
          text-transform: uppercase;
          letter-spacing: .12em;
          font-size: 10px;
        }
        .cvg-search:focus {
          border-color: color-mix(in srgb, var(--gold) 55%, transparent);
          box-shadow: 0 3px 14px rgba(232,160,32,.28);
        }
        .cvg-search-icon {
          position: absolute;
          left: 33px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted);
          pointer-events: none;
        }

        .cvg-scroll {
          flex: 1 1 auto;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .cvg-scroll::-webkit-scrollbar { width: 8px; }
        .cvg-scroll::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--on-ink) 18%, transparent);
          border-radius: 8px;
        }

        .cvg-group { padding: 14px 22px 4px; }
        .cvg-group-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .cvg-group-count {
          font-family: ${MONO};
          font-size: 10px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }

        .cvg-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 10px;
          border-radius: 10px;
          border: 1px solid transparent;
          transition: background .14s ease, border-color .14s ease;
        }
        .cvg-row:hover {
          background: color-mix(in srgb, var(--on-ink) 6%, transparent);
          border-color: color-mix(in srgb, var(--gold) 22%, transparent);
        }
        .cvg-row-name {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 13.5px;
          color: var(--on-ink);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cvg-row-key {
          display: block;
          font-family: ${MONO};
          font-size: 9px;
          letter-spacing: .06em;
          color: var(--muted);
          margin-top: 2px;
        }

        .cvg-badge {
          flex: 0 0 auto;
          font-family: ${MONO};
          font-size: 9px;
          letter-spacing: .12em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 999px;
          border: 1px solid;
          font-variant-numeric: tabular-nums;
        }
        .cvg-chip {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: ${MONO};
          font-size: 9px;
          letter-spacing: .1em;
          text-transform: uppercase;
          padding: 3px 7px;
          border-radius: 6px;
          color: var(--muted);
          border: 1px solid color-mix(in srgb, var(--on-ink) 14%, transparent);
          background: color-mix(in srgb, var(--ink) 45%, transparent);
        }
        .cvg-chip[data-mode='map-layer'] {
          color: var(--gold);
          border-color: color-mix(in srgb, var(--gold) 34%, transparent);
        }

        .cvg-footer {
          flex: 0 0 auto;
          padding: 13px 22px 16px;
          border-top: 1px solid color-mix(in srgb, var(--on-ink) 10%, transparent);
          display: flex;
          gap: 9px;
          align-items: flex-start;
          font-family: ${MONO};
          font-size: 10px;
          line-height: 1.5;
          letter-spacing: .02em;
          color: var(--muted);
        }
        .cvg-footer strong { color: var(--on-ink); font-weight: 500; }

        .cvg-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 12px;
          padding: 48px 30px;
          color: var(--muted);
        }
        .cvg-state-title {
          font-family: ${SERIF};
          font-size: 20px;
          color: var(--on-ink);
        }
        .cvg-retry {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: ${MONO};
          font-size: 11px;
          letter-spacing: .08em;
          text-transform: uppercase;
          padding: 9px 16px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--gold) 45%, transparent);
          background: color-mix(in srgb, var(--gold) 14%, transparent);
          color: var(--gold);
          cursor: pointer;
          transition: box-shadow .2s ease, background .2s ease;
        }
        .cvg-retry:hover { box-shadow: 0 3px 14px rgba(232,160,32,.28); }

        .cvg-skeleton-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 11px 10px;
        }
        .cvg-shimmer {
          display: inline-block;
          border-radius: 6px;
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--on-ink) 8%, transparent) 25%,
            color-mix(in srgb, var(--on-ink) 16%, transparent) 37%,
            color-mix(in srgb, var(--on-ink) 8%, transparent) 63%
          );
          background-size: 400% 100%;
          animation: cvg-shimmer 1.4s ease infinite;
        }
        @keyframes cvg-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>

      {/* Launcher */}
      <button
        ref={launcherRef}
        type="button"
        className="cvg-launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open intelligence coverage panel"
        onClick={openDrawer}
      >
        <span className="cvg-dot" aria-hidden="true" />
        Coverage
      </button>

      {/* Drawer + overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="cvg-overlay"
              className="cvg-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onMouseDown={onOverlayMouseDown}
            />
            <motion.div
              key="cvg-drawer"
              ref={drawerRef}
              className="cvg-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Intelligence coverage"
              initial={{ x: '-100%', opacity: 0.4 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0.4 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              <div className="cvg-header">
                <span className="cvg-eyebrow">Kammandor Intel</span>
                <h2 className="cvg-title">Intelligence Coverage</h2>
                <div className="cvg-counts">
                  <span className="cvg-count-main">
                    {state === 'ready'
                      ? `${total} sources monitored`
                      : 'Coverage'}
                  </span>
                  {state === 'ready' && total > 0 && (
                    <span className="cvg-count-sub">
                      {mapLayers} map layers · {governed} governed
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="cvg-close"
                  aria-label="Close coverage panel"
                  onClick={closeDrawer}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              {/* Search — only meaningful once we have data */}
              {state === 'ready' && total > 0 && (
                <div className="cvg-search-wrap">
                  <Search
                    size={13}
                    className="cvg-search-icon"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchRef}
                    type="text"
                    className="cvg-search"
                    placeholder="Filter sources…"
                    aria-label="Filter sources by name or category"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              )}

              {/* Body */}
              <div className="cvg-scroll">
                {state === 'loading' && <SkeletonRows />}

                {state === 'error' && (
                  <div className="cvg-state" role="alert">
                    <AlertTriangle
                      size={26}
                      color="var(--gold)"
                      aria-hidden="true"
                    />
                    <div className="cvg-state-title">
                      Coverage temporarily unavailable
                    </div>
                    <button
                      type="button"
                      className="cvg-retry"
                      onClick={() => void load()}
                    >
                      <RotateCw size={13} aria-hidden="true" />
                      Retry
                    </button>
                  </div>
                )}

                {state === 'ready' && total === 0 && (
                  <div className="cvg-state">
                    <Layers size={24} aria-hidden="true" />
                    <div className="cvg-state-title">
                      No sources reported yet
                    </div>
                  </div>
                )}

                {state === 'ready' &&
                  total > 0 &&
                  filteredCount === 0 && (
                    <div className="cvg-state">
                      <Search size={22} aria-hidden="true" />
                      <div
                        className="cvg-count-sub"
                        style={{ letterSpacing: '.1em' }}
                      >
                        No sources match “{query.trim()}”
                      </div>
                    </div>
                  )}

                {state === 'ready' &&
                  filteredCount > 0 &&
                  groups.map((group) => (
                    <section className="cvg-group" key={group.category}>
                      <div className="cvg-group-head">
                        <span className="cvg-eyebrow">
                          {humaniseCategory(group.category)}
                        </span>
                        <span className="cvg-group-count">
                          {group.sources.length}
                        </span>
                      </div>
                      {group.sources.map((s) => (
                        <div className="cvg-row" key={s.key}>
                          <span className="cvg-row-name">
                            {humaniseKey(s.key)}
                            <span className="cvg-row-key">{s.key}</span>
                          </span>
                          <ModeChip mode={s.render_mode} />
                          <TierBadge tier={s.tier} />
                        </div>
                      ))}
                    </section>
                  ))}
              </div>

              {/* Footer trust strip */}
              {state === 'ready' && total > 0 && (
                <div className="cvg-footer">
                  <ShieldCheck
                    size={14}
                    color="var(--live)"
                    style={{ flex: '0 0 auto', marginTop: 1 }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>Governed sources:</strong> human-approved,
                    licence-per-fact. {sanctionsNote}
                  </span>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
