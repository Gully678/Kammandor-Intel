'use client';

import * as React from 'react';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Decision = 'pending' | 'show' | 'hidden';

interface Chip {
  readonly label: string;
  readonly at: number; // progress threshold (0–100) at which the chip lights
}

const STORAGE_KEY = 'km_intel_booted';
const BAR_MS = 2200; // gold bar fill duration
const HOLD_MS = 400; // dwell on "SYSTEMS ONLINE" before exit
const FADE_MS = 500; // fade-out duration
const REDUCED_MS = 800; // static splash duration when motion is reduced
const STATUS_STEP_MS = 350;
const SOURCE_TARGET = 51;

const STATUS_MESSAGES: readonly string[] = [
  'ESTABLISHING SECURE LINK',
  'LOADING 51 SOURCES',
  'AIRCRAFT · MARITIME · SATELLITE',
  'CONFLICT · CYBER · SANCTIONS',
  'GOVERNANCE LAYER ARMED',
  'SYSTEMS ONLINE',
];

const CHIPS: readonly Chip[] = [
  { label: 'AIRCRAFT', at: 12 },
  { label: 'MARITIME', at: 28 },
  { label: 'SATELLITE', at: 44 },
  { label: 'CONFLICT', at: 60 },
  { label: 'CYBER', at: 76 },
  { label: 'FINANCIAL', at: 92 },
];

const SCOPED_CSS = `
.boot-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(120% 90% at 50% 42%, color-mix(in srgb, var(--gold-deep) 9%, transparent) 0%, transparent 55%),
    color-mix(in srgb, var(--ink) 98%, transparent);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  color: var(--on-ink);
  cursor: pointer;
  overflow: hidden;
}
.boot-stage {
  width: min(560px, 86vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.boot-wordmark {
  font-family: 'Instrument Serif', serif;
  font-weight: 400;
  font-size: clamp(34px, 6.5vw, 62px);
  line-height: 1.02;
  letter-spacing: 0.06em;
  color: var(--on-ink);
  margin: 0 0 26px;
  text-shadow: 0 0 40px color-mix(in srgb, var(--gold) 14%, transparent);
}
.boot-barwrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}
.boot-bar {
  position: relative;
  width: 100%;
  height: 2px;
  background: color-mix(in srgb, var(--on-ink) 10%, transparent);
  border-radius: 2px;
  overflow: hidden;
}
.boot-bar-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  background: linear-gradient(90deg, var(--gold-deep), var(--gold));
  box-shadow: 0 0 10px color-mix(in srgb, var(--gold) 55%, transparent);
  border-radius: 2px;
  will-change: width;
}
.boot-meta {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.boot-status {
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  color: var(--gold-text);
  min-height: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.boot-count {
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
  flex: none;
}
.boot-count b {
  color: var(--on-ink);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}
.boot-chips {
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.boot-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--on-ink) 10%, transparent);
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 9px;
  color: var(--muted);
  transition: color 260ms ease, border-color 260ms ease, background-color 260ms ease;
}
.boot-chip[data-lit='true'] {
  color: var(--on-ink);
  border-color: color-mix(in srgb, var(--gold) 42%, transparent);
  background: color-mix(in srgb, var(--gold) 8%, transparent);
}
.boot-tick {
  width: 10px;
  height: 10px;
  color: var(--muted);
  transition: color 260ms ease, transform 260ms ease;
  transform: scale(0.8);
}
.boot-chip[data-lit='true'] .boot-tick {
  color: var(--gold);
  transform: scale(1);
}
.boot-skip {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  appearance: none;
  background: none;
  border: none;
  padding: 8px 12px;
  font-family: 'DM Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 9px;
  color: var(--muted);
  cursor: pointer;
  transition: color 200ms ease;
}
.boot-skip:hover {
  color: var(--on-ink);
}
`;

export default function BootSequence(): React.ReactElement | null {
  const [decision, setDecision] = useState<Decision>('pending');
  const [reduced, setReduced] = useState<boolean>(false);
  const [exiting, setExiting] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [statusIndex, setStatusIndex] = useState<number>(0);

  const exitStartedRef = useRef<boolean>(false);

  const beginExit = useCallback((): void => {
    if (exitStartedRef.current) return;
    exitStartedRef.current = true;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage unavailable — degrade gracefully */
    }
    setExiting(true);
  }, []);

  // Decide (once) whether to show, and detect reduced motion. SSR-safe.
  useEffect((): void => {
    if (typeof window === 'undefined') return;
    let alreadyBooted = false;
    try {
      alreadyBooted = window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      alreadyBooted = false;
    }
    if (alreadyBooted) {
      setDecision('hidden');
      return;
    }
    try {
      setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      setReduced(false);
    }
    setDecision('show');
  }, []);

  // Drive the boot animation (or the short static splash under reduced motion).
  useEffect((): (() => void) | void => {
    if (decision !== 'show') return;

    if (reduced) {
      const t = window.setTimeout((): void => beginExit(), REDUCED_MS);
      return (): void => window.clearTimeout(t);
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const elapsed = now - start;
      const p = Math.min(100, (elapsed / BAR_MS) * 100);
      setProgress(p);
      if (p < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    let idx = 0;
    const statusTimer = window.setInterval((): void => {
      idx += 1;
      if (idx >= STATUS_MESSAGES.length) {
        setStatusIndex(STATUS_MESSAGES.length - 1);
        window.clearInterval(statusTimer);
      } else {
        setStatusIndex(idx);
      }
    }, STATUS_STEP_MS);

    const exitTimer = window.setTimeout((): void => beginExit(), BAR_MS + HOLD_MS);

    return (): void => {
      cancelAnimationFrame(raf);
      window.clearInterval(statusTimer);
      window.clearTimeout(exitTimer);
    };
  }, [decision, reduced, beginExit]);

  // Once fading, unmount after the fade completes.
  useEffect((): (() => void) | void => {
    if (!exiting) return;
    const t = window.setTimeout((): void => setDecision('hidden'), FADE_MS);
    return (): void => window.clearTimeout(t);
  }, [exiting]);

  // ESC dismisses immediately.
  useEffect((): (() => void) | void => {
    if (decision !== 'show') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') beginExit();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [decision, beginExit]);

  if (decision !== 'show') return null;

  const displayProgress = reduced ? 100 : progress;
  const sources = reduced ? SOURCE_TARGET : Math.round((progress / 100) * SOURCE_TARGET);
  const status = STATUS_MESSAGES[reduced ? STATUS_MESSAGES.length - 1 : statusIndex];
  const staged = !reduced;

  return (
    <AnimatePresence>
      <motion.div
        key="km-boot"
        className="boot-overlay"
        role="status"
        aria-live="polite"
        aria-label="Kammandor Intel — systems coming online"
        initial={{ opacity: staged ? 0 : 1 }}
        animate={{ opacity: exiting ? 0 : 1 }}
        transition={{ duration: exiting ? FADE_MS / 1000 : 0.28, ease: 'easeOut' }}
        style={{ pointerEvents: exiting ? 'none' : 'auto' }}
        onClick={(): void => beginExit()}
      >
        <style>{SCOPED_CSS}</style>

        <div className="boot-stage" onClick={(e): void => e.stopPropagation()}>
          <motion.h1
            className="boot-wordmark"
            initial={{ opacity: staged ? 0 : 1, y: staged ? 14 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: staged ? 0.7 : 0, ease: [0.16, 1, 0.3, 1] }}
          >
            KAMMANDOR INTEL
          </motion.h1>

          <motion.div
            className="boot-barwrap"
            initial={{ opacity: staged ? 0 : 1 }}
            animate={{ opacity: 1 }}
            transition={{ duration: staged ? 0.5 : 0, delay: staged ? 0.25 : 0 }}
          >
            <div className="boot-bar" aria-hidden="true">
              <div
                className="boot-bar-fill"
                style={{ width: `${displayProgress}%` }}
              />
            </div>

            <div className="boot-meta">
              <div className="boot-status">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={status}
                    initial={{ opacity: staged ? 0 : 1, y: staged ? 4 : 0 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: staged ? -4 : 0 }}
                    transition={{ duration: staged ? 0.18 : 0 }}
                  >
                    {status}
                  </motion.span>
                </AnimatePresence>
              </div>
              <div className="boot-count">
                <b>{sources.toString().padStart(2, '0')}</b>&nbsp;/&nbsp;{SOURCE_TARGET} SOURCES
              </div>
            </div>
          </motion.div>

          <div className="boot-chips" aria-hidden="true">
            {CHIPS.map((chip: Chip): React.ReactElement => {
              const lit = displayProgress >= chip.at;
              return (
                <span key={chip.label} className="boot-chip" data-lit={lit}>
                  <svg
                    className="boot-tick"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.4 L4.8 8.6 L9.5 3.4" />
                  </svg>
                  {chip.label}
                </span>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          className="boot-skip"
          onClick={(e): void => {
            e.stopPropagation();
            beginExit();
          }}
        >
          Skip
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
