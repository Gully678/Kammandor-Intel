"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { GoldItalic } from "./ui";

const TRACE_ROWS = [
  ["agent", "watcher", ""],
  ["input", "events: this cycle · watchlist: yours", ""],
  ["tool_call", "match_signals()", "✓ ok"],
  ["tool_call", "classify_severity()", "✓ ok · rules-based"],
  ["tool_call", "propose_alert()", "✓ ok · proposal only"],
  ["output", "2 alerts · rationale attached", ""],
  ["truth-store", "untouched — agents cannot write facts", ""],
  ["status", "", "succeeded · trace persisted"],
] as const;

const CHECKS = [
  ["Show the raw.", "Every agent run records what went in, every tool it used, and what came out — inspect the full trace of any answer."],
  ["Least privilege, by construction.", "Each agent is handed only the specific tools it was declared to use. It cannot reach anything else."],
  ["A pass bar you can see.", "AI capabilities are tested against gold-standard suites with a hard 80% floor no suite can lower. Fail the bar, and it doesn't ship."],
  ["No model ever grades its own homework.", "Seriousness levels and figures come from deterministic rules — never from a model's say-so."],
] as const;

function EvalBar() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduced = useReducedMotion();
  const [pct, setPct] = useState(reduced ? 100 : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let raf: number;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1400);
      setPct(Math.round(100 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced]);

  return (
    <div ref={ref} className="mt-3.5 rounded-card border border-card-border bg-card px-5 py-5 shadow-card">
      <div className="mb-3 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
        <span>Gold-suite evaluation</span>
        <span className="num">{(pct / 100).toFixed(2)}{pct === 100 ? " · PASS" : ""}</span>
      </div>
      <div className="relative h-[9px] rounded-[5px] bg-tint">
        <div
          className="h-full rounded-[5px] bg-gradient-to-r from-gold-deep to-gold"
          style={{ width: `${pct}%`, transition: reduced ? "none" : undefined }}
        />
        <div className="absolute -bottom-1.5 -top-1.5 left-[80%] w-0.5 bg-s-red" aria-hidden>
          <span className="absolute -top-5 left-[-28px] whitespace-nowrap font-mono text-[8.5px] tracking-[0.06em] text-s-red">
            0.80 floor — structural
          </span>
        </div>
      </div>
    </div>
  );
}

export function AuditSection() {
  return (
    <section id="audit" className="pb-28">
      <div className="wrap grid items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <div className="eyebrow flex items-center gap-3">
            <span className="h-px w-6 bg-gold/70" aria-hidden />
            AI you can audit
          </div>
          <h2 className="font-serif text-[clamp(32px,4.4vw,50px)] leading-[1.08]">
            No black box. <GoldItalic>Ever.</GoldItalic>
          </h2>
          <p className="mt-4 max-w-[600px] text-[16.5px] leading-[1.7] text-body-2">
            Every answer comes with its sources and its working — and every AI capability has to
            pass before it ships.
          </p>
          <div className="mt-6 flex flex-col gap-3.5">
            {CHECKS.map(([title, body]) => (
              <div key={title} className="flex gap-3 text-sm text-body-2">
                <span className="flex-none font-bold text-s-green">✓</span>
                <span>
                  <b className="font-semibold text-body">{title}</b> {body}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="overflow-hidden rounded-card bg-ink font-mono text-[11.5px] shadow-frame">
            <div className="flex justify-between border-b border-white/10 px-4.5 px-5 py-2.5 text-[9.5px] tracking-[0.14em] text-on-ink-dim2">
              <span>AGENT RUN — FULL TRACE</span>
              <span>show raw</span>
            </div>
            <Stagger className="px-5 py-4 leading-[2.05] text-on-ink-dim">
              {TRACE_ROWS.map(([k, v, ok]) => (
                <StaggerItem key={k + v}>
                  <div>
                    <span className="inline-block w-[104px] text-on-ink-dim2">{k}</span>
                    {v && <span className="text-on-ink">{v}</span>}
                    {ok && <span className="text-gold-light"> {ok}</span>}
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <EvalBar />
        </Reveal>
      </div>
    </section>
  );
}
