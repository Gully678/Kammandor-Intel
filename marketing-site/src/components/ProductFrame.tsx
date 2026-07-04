"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { SIGNALS, type Severity } from "@/lib/content";
import { LogoMark } from "./Logo";

const SEV_STYLE: Record<Severity, string> = {
  critical: "text-s-red bg-s-red-bg",
  notable: "text-s-amber bg-s-amber-bg",
  background: "text-s-grey bg-s-grey-bg",
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "Critical",
  notable: "Notable",
  background: "Background",
};

function timeAgo(offsetMin: number) {
  const d = new Date(Date.now() - offsetMin * 60000);
  return d.toTimeString().slice(0, 5);
}

function Kpi({ label, value, sub, crit }: { label: string; value: number; sub: string; crit?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let raf: number;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduced]);

  return (
    <div ref={ref} className="rounded-tile border border-card-border bg-card px-3 py-2.5">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-faint">{label}</div>
      <div className="num mt-0.5 text-[19px] font-bold tracking-[-0.01em]">{n}</div>
      <div className={`text-[9.5px] ${crit ? "text-s-red" : "text-faint-2"}`}>{sub}</div>
    </div>
  );
}

export function ProductFrame() {
  const reduced = useReducedMotion();
  const [feed, setFeed] = useState(() =>
    [2, 1, 0].map((offset, i) => ({ signal: SIGNALS[i], offset: offset * 11, key: i }))
  );
  const [approved, setApproved] = useState(false);
  const idxRef = useRef(3);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => {
      setFeed((prev) => {
        const key = idxRef.current;
        const signal = SIGNALS[key % SIGNALS.length];
        idxRef.current += 1;
        return [{ signal, offset: 0, key }, ...prev].slice(0, 3);
      });
    }, 6400);
    return () => clearInterval(t);
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setApproved(true), 6000);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <div className="mx-auto max-w-[1080px] overflow-hidden rounded-card border border-card-border bg-card shadow-frame">
      {/* browser bar */}
      <div className="flex items-center gap-2.5 border-b border-divide bg-table-head px-4 py-2.5">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <i key={i} className="h-[9px] w-[9px] rounded-full bg-input-border" />
          ))}
        </span>
        <span className="max-w-[340px] flex-1 rounded-[7px] border border-input-border bg-card px-3 py-1 font-mono text-[10.5px] text-faint">
          intelligence — dashboard
        </span>
        <span className="rounded-[5px] bg-s-amber-bg px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] text-s-amber">
          ILLUSTRATIVE
        </span>
      </div>

      <div className="flex min-h-[472px]">
        {/* ink sidebar */}
        <div className="hidden w-[158px] flex-none flex-col gap-0.5 bg-ink p-3 sm:flex">
          <div className="flex items-center gap-2 px-2 pb-3.5 pt-1">
            <LogoMark size={17} dots={false} />
            <span className="font-serif text-[15.5px] text-on-ink">Kammandor</span>
          </div>
          {[
            { g: "◉", label: "Dashboard", on: true },
            { g: "◎", label: "Map", on: false },
            { g: "▤", label: "Review", on: false, badge: approved ? "2" : "3" },
          ].map((item) => (
            <div
              key={item.label}
              className={`relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px] ${
                item.on ? "text-on-ink" : "text-on-ink-dim"
              }`}
            >
              {item.on && (
                <>
                  <span className="absolute inset-0 rounded-lg bg-gold/15" aria-hidden />
                  <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-sm bg-gold" aria-hidden />
                </>
              )}
              <span className="relative w-3.5 text-center text-[11px]">{item.g}</span>
              <span className="relative">{item.label}</span>
              {item.badge && (
                <span className="relative ml-auto rounded-full bg-gold px-1.5 py-px font-mono text-[9px] font-medium text-ink">
                  {item.badge}
                </span>
              )}
            </div>
          ))}
          <div className="mt-auto rounded-[9px] border border-white/10 bg-white/5 px-2 py-2 font-mono text-[10px] tracking-[0.06em] text-on-ink-dim">
            YOUR&nbsp;FIRM&nbsp;·&nbsp;USD
          </div>
        </div>

        {/* main */}
        <div className="min-w-0 flex-1 bg-page px-4 py-4">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-gold-text">
            Intelligence · watching around the clock
          </div>
          <div className="mb-3 font-serif text-[22px]">Good morning.</div>

          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Open alerts" value={7} sub="1 critical" crit />
            <Kpi label="Your decision" value={3} sub="waiting" />
            <Kpi label="Watched" value={24} sub="entities" />
            <Kpi label="Agent runs" value={48} sub="24h · traced" />
          </div>

          <div className="grid gap-2 md:grid-cols-[1.25fr_1fr]">
            {/* live signals */}
            <div className="min-w-0 rounded-tile border border-card-border bg-card px-3 py-3">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-pulse"
                  animate={reduced ? undefined : { opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2.2, repeat: Infinity }}
                />
                Live signals
              </div>
              <AnimatePresence initial={false} mode="popLayout">
                {feed.map(({ signal, offset, key }, i) => (
                  <motion.div
                    key={key}
                    layout
                    initial={reduced ? false : { opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeOut" }}
                    className={`py-2 ${i > 0 ? "border-t border-divide" : ""}`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-px font-mono text-[9px] font-medium uppercase tracking-[0.1em] ${SEV_STYLE[signal.severity]}`}
                      >
                        {SEV_LABEL[signal.severity]}
                      </span>
                      <span className="num ml-auto font-mono text-[9px] text-faint-2">
                        {timeAgo(offset)}
                      </span>
                    </div>
                    <div className="text-[11.5px] leading-[1.45]">{signal.title}</div>
                    <div className="mt-0.5 text-[10px] text-muted">{signal.why}</div>
                    <span className="receipt mt-1.5 !px-2 !text-[9px]">{signal.receipt}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* review queue */}
            <div className="min-w-0 rounded-tile border border-card-border bg-card px-3 py-3">
              <div className="mb-2.5 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
                Awaiting your decision
              </div>

              <div className="rounded-[10px] border border-divide bg-hover-row px-2.5 py-2.5">
                <div className="mb-1.5 text-[11px] leading-[1.5]">
                  Add link: <b className="font-semibold">watched company → new registry filing</b>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <span className="receipt !px-2 !text-[9px]">source: public registry</span>
                  <span className="receipt !px-2 !text-[9px]">licence: open</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setApproved(true)}
                    className={`rounded-lg px-3 py-1 text-[10.5px] font-semibold transition-opacity ${
                      approved ? "bg-ink/50 text-on-ink" : "bg-ink text-on-ink"
                    }`}
                  >
                    Approve
                  </button>
                  <span className="rounded-lg border border-input-border bg-card px-3 py-1 text-[10.5px] font-semibold text-body-2">
                    Reject
                  </span>
                </div>
                <AnimatePresence>
                  {approved && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-2 font-mono text-[9px] tracking-[0.08em] text-s-green"
                    >
                      ✓ APPROVED · RECORDED FOREVER
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="mt-2 rounded-[10px] border border-divide bg-hover-row px-2.5 py-2.5">
                <div className="mb-1.5 text-[11px] leading-[1.5]">
                  Merge duplicates: <b className="font-semibold">two records, one company</b>
                </div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <span className="receipt !px-2 !text-[9px]">proposed by: resolver agent</span>
                </div>
                <div className="flex gap-1.5">
                  <span className="rounded-lg bg-ink px-3 py-1 text-[10.5px] font-semibold text-on-ink">
                    Approve
                  </span>
                  <span className="rounded-lg border border-input-border bg-card px-3 py-1 text-[10.5px] font-semibold text-body-2">
                    Reject
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* footer strip */}
      <div className="flex items-center justify-between border-t border-divide px-4 py-2 font-mono text-[10px] text-faint">
        <span>every fact · source + licence attached</span>
        <span className="text-gold-text">awaiting your decision →</span>
      </div>
    </div>
  );
}
