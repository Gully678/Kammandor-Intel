'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Inbox,
  Globe,
  LayoutDashboard,
  Ship,
  Video,
  Newspaper,
  Activity,
  Swords,
  Plane,
  Satellite,
  ShieldAlert,
  Network,
  Flame,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Radio,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type GroupName = 'Navigation' | 'Map layers' | 'Live sources';

interface CommandItem {
  id: string;
  group: GroupName;
  label: string;
  keywords: string;
  category?: string;
  meta?: string;
  active?: boolean;
  icon: LucideIcon;
  closeOnRun: boolean;
  run: () => void;
}

interface ToolSource {
  key: string;
  category: string;
  render_mode: string;
  tier: string;
}

interface ToolsResponse {
  sources?: ToolSource[];
}

interface LayerDef {
  key: string;
  name: string;
  icon: LucideIcon;
}

/* ------------------------------------------------------------------ */
/* Static data                                                        */
/* ------------------------------------------------------------------ */

const LAYERS: readonly LayerDef[] = [
  { key: 'maritime', name: 'Maritime', icon: Ship },
  { key: 'cctv', name: 'CCTV', icon: Video },
  { key: 'live_news', name: 'Live News', icon: Newspaper },
  { key: 'earthquakes', name: 'Earthquakes', icon: Activity },
  { key: 'conflicts', name: 'Conflicts', icon: Swords },
  { key: 'flights', name: 'Flights', icon: Plane },
  { key: 'satellites', name: 'Satellites', icon: Satellite },
  { key: 'cyber', name: 'Cyber', icon: ShieldAlert },
  { key: 'infrastructure', name: 'Infrastructure', icon: Network },
  { key: 'fires', name: 'Fires', icon: Flame },
] as const;

const FEATURED_LAYERS: readonly string[] = [
  'maritime',
  'live_news',
  'conflicts',
  'flights',
  'earthquakes',
] as const;

const GROUP_ORDER: readonly GroupName[] = [
  'Navigation',
  'Map layers',
  'Live sources',
] as const;

const ACRONYMS = new Set<string>([
  'ofac',
  'sdn',
  'cctv',
  'ais',
  'un',
  'eu',
  'us',
  'uk',
  'noaa',
  'usgs',
  'faa',
  'imo',
  'api',
  'osint',
  'sigint',
  'adsb',
  'gdelt',
]);

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function humanise(key: string): string {
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) =>
      ACRONYMS.has(w.toLowerCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

function readLayers(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = new URLSearchParams(window.location.search).get('layers');
  return raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function CommandPalette(): React.ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [sources, setSources] = useState<ToolSource[]>([]);
  const [activeLayers, setActiveLayers] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<boolean>(open);
  const fetchedRef = useRef<boolean>(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /* -- actions -- */

  const go = useCallback((path: string): void => {
    if (typeof window === 'undefined') return;
    window.location.assign(path);
  }, []);

  const toggleLayer = useCallback((key: string): void => {
    if (typeof window === 'undefined') return;
    const set = new Set(readLayers());
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const csv = Array.from(set).join(',');
    window.location.assign(csv ? `/?layers=${csv}` : '/');
  }, []);

  const flashNote = useCallback((message: string): void => {
    setNote(message);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 4200);
  }, []);

  /* -- global hotkeys (bound once) -- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && openRef.current) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (
        e.key === '/' &&
        !openRef.current &&
        !isMod &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  /* -- on open: focus, refresh layers, background-fetch sources, lock scroll -- */

  useEffect(() => {
    if (!open) return;

    setActiveLayers(readLayers());
    setSelectedIndex(0);

    const focusId = window.setTimeout(() => inputRef.current?.focus(), 20);

    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetch('/api/ai/tools')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
        .then((d: unknown) => {
          const data = d as ToolsResponse;
          if (Array.isArray(data?.sources)) {
            const clean = data.sources.filter(
              (s): s is ToolSource =>
                !!s && typeof s.key === 'string' && typeof s.category === 'string',
            );
            setSources(clean);
          }
        })
        .catch(() => {
          /* silent — palette works without live sources */
        });
    }

    const prevOverflow =
      typeof document !== 'undefined' ? document.body.style.overflow : '';
    if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(focusId);
      if (typeof document !== 'undefined') {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [open]);

  /* -- build the full command set -- */

  const allCommands = useMemo<CommandItem[]>(() => {
    const activeSet = new Set(activeLayers);

    const nav: CommandItem[] = [
      {
        id: 'nav-dashboard',
        group: 'Navigation',
        label: 'Open Dashboard',
        keywords: 'dashboard home metrics overview',
        icon: LayoutDashboard,
        closeOnRun: true,
        run: () => go('/dashboard'),
      },
      {
        id: 'nav-review',
        group: 'Navigation',
        label: 'Open Review inbox',
        keywords: 'review inbox queue triage approve pending',
        icon: Inbox,
        closeOnRun: true,
        run: () => go('/review'),
      },
      {
        id: 'nav-map',
        group: 'Navigation',
        label: 'Map home',
        keywords: 'map home globe world live view',
        icon: Globe,
        closeOnRun: true,
        run: () => go('/'),
      },
    ];

    const layers: CommandItem[] = LAYERS.map((l) => {
      const on = activeSet.has(l.key);
      return {
        id: `layer-${l.key}`,
        group: 'Map layers',
        label: `Toggle layer: ${l.name}`,
        keywords: `${l.name} ${l.key} layer toggle overlay map`,
        meta: on ? 'On' : 'Off',
        active: on,
        icon: l.icon,
        closeOnRun: true,
        run: () => toggleLayer(l.key),
      };
    });

    const live: CommandItem[] = sources.map((s) => {
      const name = humanise(s.key);
      const category = humanise(s.category);
      const tier = s.tier ? s.tier.toUpperCase() : '—';
      return {
        id: `src-${s.key}`,
        group: 'Live sources',
        label: name,
        keywords: `${s.key} ${s.category} ${s.render_mode} ${s.tier} source feed`,
        category,
        meta: `${category} · ${tier}`,
        icon: Radio,
        closeOnRun: false,
        run: () => flashNote(`Source: ${name} — ${category} (${tier})`),
      };
    });

    return [...nav, ...layers, ...live];
  }, [activeLayers, sources, go, toggleLayer, flashNote]);

  /* -- filter -- */

  const filtered = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const featured = allCommands.filter(
        (c) =>
          c.group === 'Map layers' &&
          FEATURED_LAYERS.some((k) => c.id === `layer-${k}`),
      );
      const nav = allCommands.filter((c) => c.group === 'Navigation');
      return [...nav, ...featured];
    }
    return allCommands.filter((c) => {
      const hay = `${c.label} ${c.keywords} ${c.category ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, allCommands]);

  /* -- grouped for rendering, with a flat global index -- */

  const grouped = useMemo(() => {
    const map = new Map<GroupName, { item: CommandItem; index: number }[]>();
    filtered.forEach((item, index) => {
      const bucket = map.get(item.group) ?? [];
      bucket.push({ item, index });
      map.set(item.group, bucket);
    });
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      rows: map.get(g) as { item: CommandItem; index: number }[],
    }));
  }, [filtered]);

  const totalCommands = allCommands.length;

  /* -- keep selection in range + scroll into view -- */

  useEffect(() => {
    setSelectedIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(i, filtered.length - 1);
    });
  }, [filtered.length]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, open]);

  /* -- run + local keyboard nav -- */

  const runItem = useCallback((item: CommandItem): void => {
    item.run();
    if (item.closeOnRun) setOpen(false);
  }, []);

  const onPanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) =>
          filtered.length === 0 ? 0 : (i + 1) % filtered.length,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) =>
          filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) runItem(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    },
    [filtered, selectedIndex, runItem],
  );

  const resultLabel = `${filtered.length} result${filtered.length === 1 ? '' : 's'}`;

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="cmdk-root"
          className="cmdk-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <style>{styles}</style>

          <div
            className="cmdk-backdrop"
            onMouseDown={() => setOpen(false)}
            aria-hidden="true"
          />

          <motion.div
            className="cmdk-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onKeyDown={onPanelKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="cmdk-inputrow">
              <Search className="cmdk-inputicon" size={18} aria-hidden="true" />
              <input
                ref={inputRef}
                className="cmdk-input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search sources, layers, actions…"
                aria-label="Search sources, layers and actions"
                autoComplete="off"
                spellCheck={false}
                type="text"
              />
              <span className="cmdk-chip" aria-hidden="true">
                ESC
              </span>
            </div>

            <div className="cmdk-results" ref={listRef} role="listbox" aria-label="Results">
              {query.trim() === '' && (
                <div className="cmdk-hintrow">
                  Type to search {totalCommands} sources, layers and actions
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="cmdk-empty">No matches for “{query.trim()}”</div>
              ) : (
                grouped.map(({ group, rows }) => (
                  <div className="cmdk-group" key={group}>
                    <div className="cmdk-grouphead">{group}</div>
                    {rows.map(({ item, index }) => {
                      const Icon = item.icon;
                      const selected = index === selectedIndex;
                      return (
                        <div
                          key={item.id}
                          data-index={index}
                          role="option"
                          aria-selected={selected}
                          className={`cmdk-row${selected ? ' cmdk-row--sel' : ''}`}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={() => runItem(item)}
                        >
                          <span className="cmdk-rowicon">
                            <Icon
                              size={16}
                              aria-hidden="true"
                              style={
                                item.active
                                  ? { color: 'var(--live)' }
                                  : undefined
                              }
                            />
                          </span>
                          <span className="cmdk-rowlabel">{item.label}</span>
                          {item.meta && (
                            <span
                              className={`cmdk-rowmeta${
                                item.active ? ' cmdk-rowmeta--on' : ''
                              }`}
                            >
                              {item.meta}
                            </span>
                          )}
                          {selected && (
                            <span className="cmdk-enter" aria-hidden="true">
                              <CornerDownLeft size={12} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <AnimatePresence>
              {note && (
                <motion.div
                  key="cmdk-note"
                  className="cmdk-note"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.16 }}
                  role="status"
                >
                  <Radio size={13} aria-hidden="true" />
                  <span>{note}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="cmdk-footer">
              <span className="cmdk-fkeys">
                <span className="cmdk-key">
                  <ArrowUp size={11} />
                  <ArrowDown size={11} />
                </span>
                navigate
                <span className="cmdk-key">
                  <CornerDownLeft size={11} />
                </span>
                select
                <span className="cmdk-key">ESC</span>
                close
              </span>
              <span className="cmdk-count">{resultLabel}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Scoped styles                                                      */
/* ------------------------------------------------------------------ */

const styles = `
.cmdk-root{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;font-family:'DM Sans',system-ui,sans-serif;}
.cmdk-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);}
.cmdk-panel{position:relative;margin-top:18vh;width:min(640px,calc(100vw - 32px));max-height:64vh;display:flex;flex-direction:column;background:color-mix(in srgb, var(--ink) 93%, transparent);border:1px solid color-mix(in srgb, var(--gold) 35%, transparent);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(12px);color:var(--on-ink);overflow:hidden;}
.cmdk-inputrow{display:flex;align-items:center;gap:10px;padding:16px 16px;border-bottom:1px solid color-mix(in srgb, var(--card-border) 22%, transparent);}
.cmdk-inputicon{color:var(--gold);flex:0 0 auto;opacity:.9;}
.cmdk-input{flex:1 1 auto;background:transparent;border:0;outline:0;color:var(--on-ink);font-family:'DM Sans',system-ui,sans-serif;font-size:17px;line-height:1.2;letter-spacing:.005em;padding:2px 0;}
.cmdk-input::placeholder{color:var(--muted);}
.cmdk-chip{flex:0 0 auto;font-family:'DM Mono',ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--on-ink);opacity:.7;padding:4px 7px;border:1px solid color-mix(in srgb, var(--card-border) 30%, transparent);border-radius:6px;background:color-mix(in srgb, var(--on-ink) 6%, transparent);}
.cmdk-results{flex:1 1 auto;overflow-y:auto;padding:6px 6px 8px;}
.cmdk-results::-webkit-scrollbar{width:9px;}
.cmdk-results::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--gold) 22%, transparent);border-radius:8px;border:2px solid transparent;background-clip:padding-box;}
.cmdk-hintrow{padding:10px 12px;font-family:'DM Mono',ui-monospace,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);opacity:.7;}
.cmdk-empty{padding:26px 14px;text-align:center;color:var(--muted);font-size:14px;}
.cmdk-group{padding:2px 0 6px;}
.cmdk-grouphead{padding:10px 12px 6px;font-family:'DM Mono',ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--gold-text);opacity:.7;}
.cmdk-row{position:relative;display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;cursor:pointer;user-select:none;transition:background .08s ease;}
.cmdk-row--sel{background:color-mix(in srgb, var(--gold) 16%, transparent);}
.cmdk-row--sel::before{content:'';position:absolute;left:2px;top:8px;bottom:8px;width:3px;border-radius:3px;background:var(--gold);}
.cmdk-rowicon{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:22px;color:var(--on-ink);opacity:.85;}
.cmdk-rowlabel{flex:1 1 auto;font-size:14.5px;color:var(--on-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cmdk-rowmeta{flex:0 0 auto;font-family:'DM Mono',ui-monospace,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);opacity:.85;font-variant-numeric:tabular-nums;}
.cmdk-rowmeta--on{color:var(--live);opacity:1;}
.cmdk-enter{flex:0 0 auto;display:flex;align-items:center;color:var(--gold-text);opacity:.8;}
.cmdk-note{display:flex;align-items:center;gap:8px;margin:0 12px 4px;padding:9px 12px;border-radius:10px;background:color-mix(in srgb, var(--live) 16%, transparent);border:1px solid color-mix(in srgb, var(--live) 40%, transparent);color:var(--on-ink);font-size:13px;}
.cmdk-note svg{color:var(--live);flex:0 0 auto;}
.cmdk-footer{display:flex;align-items:center;justify-content:space-between;padding:9px 14px;border-top:1px solid color-mix(in srgb, var(--card-border) 22%, transparent);}
.cmdk-fkeys{display:flex;align-items:center;gap:6px;font-family:'DM Mono',ui-monospace,monospace;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);opacity:.7;}
.cmdk-key{display:inline-flex;align-items:center;gap:2px;padding:2px 5px;border:1px solid color-mix(in srgb, var(--card-border) 30%, transparent);border-radius:5px;color:var(--on-ink);opacity:.85;}
.cmdk-count{font-family:'DM Mono',ui-monospace,monospace;font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--gold-text);opacity:.8;font-variant-numeric:tabular-nums;}
@media (max-width:640px){.cmdk-panel{margin-top:12vh;width:calc(100vw - 24px);max-height:74vh;}.cmdk-input{font-size:16px;}}
`;
