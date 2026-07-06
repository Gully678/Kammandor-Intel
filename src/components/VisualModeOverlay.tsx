'use client';

/**
 * KINTEL WS-2 — Visual modes (FLIR / NVG / CRT) as post-processing overlays.
 *
 * Self-contained: manages its own state, renders a full-viewport
 * pointer-events-none filter layer (z below the UI panels so only the MAP is
 * tinted, not the chrome) plus a small on-brand cycler control. DEFAULT and
 * SATELLITE map styles are handled by the existing map-style toggle; this adds
 * the remaining thermal/night-vision/CRT looks the brand calls for.
 *
 * Zero coupling to page.tsx internals — mounts with a single <VisualModeOverlay/>.
 */

import { useState, useCallback } from 'react';

const MODES = ['default', 'flir', 'nvg', 'crt'] as const;
type VMode = (typeof MODES)[number];

const LABEL: Record<VMode, string> = {
  default: 'DEFAULT',
  flir: 'FLIR',
  nvg: 'NVG',
  crt: 'CRT',
};

export default function VisualModeOverlay() {
  const [mode, setMode] = useState<VMode>('default');

  const cycle = useCallback(() => {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length]);
  }, []);

  return (
    <>
      {mode !== 'default' && (
        <div className={`vmode-overlay vmode-${mode}`} aria-hidden="true" />
      )}
      <button
        type="button"
        onClick={cycle}
        title={`Visual mode: ${LABEL[mode]} — click to cycle (DEFAULT · FLIR · NVG · CRT)`}
        className="glass-panel absolute bottom-[75px] md:bottom-[100px] right-5 z-[200] px-3 py-2 pointer-events-auto font-mono text-[10px] tracking-widest text-[var(--gold-primary)] hover:border-[var(--gold-primary)]/40 transition-colors"
      >
        <span aria-hidden="true">◉ </span>
        {LABEL[mode]}
      </button>
    </>
  );
}
