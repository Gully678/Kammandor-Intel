"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { STATS } from "@/lib/content";
import { Reveal } from "./Reveal";

function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let raf: number;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, reduced]);

  return (
    <span ref={ref} className="num">
      {n}
    </span>
  );
}

export function StatBand() {
  return (
    <section className="bg-ink py-[74px] text-on-ink">
      <div className="wrap grid grid-cols-2 gap-9 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.mark} delay={i * 0.08}>
            <div className="font-serif text-[46px] leading-none">
              {s.value !== null ? <CountUp value={s.value} /> : s.text}
              <i className="italic text-gold">{s.suffix}</i>
            </div>
            <div className="mt-3 text-[13px] leading-[1.55] text-on-ink-dim">{s.label}</div>
            <div className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-gold">
              {s.mark}
            </div>
          </Reveal>
        ))}
      </div>
      {/* receipt marquee */}
      <div className="mt-14 overflow-hidden border-t border-white/10 pt-5" aria-hidden>
        <div className="km-marquee flex w-max gap-10 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-on-ink-dim2">
          {Array.from({ length: 2 }).map((_, half) => (
            <span key={half} className="flex gap-10">
              {[
                "every fact · source + licence attached",
                "propose → evaluate → human-approve → audited-write",
                "no black box · show the raw",
                "severity by rules, never by model whim",
                "your data · your servers · your rules",
              ].map((t) => (
                <span key={t} className="flex items-center gap-10">
                  <span>{t}</span>
                  <span className="text-gold">◆</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
