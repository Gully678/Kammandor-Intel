"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { Reveal } from "./Reveal";

const TERM_LINES = [
  { p: "$", t: " git clone <the engine>" },
  { p: "$", t: " docker compose up" },
  { c: "# the governed intelligence layer — on your metal" },
  { c: "# dashboard · review queue · signals · API" },
  { p: "$", t: " ", c: "the code is the demo." },
];

function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? TERM_LINES.length : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= TERM_LINES.length) clearInterval(t);
    }, 550);
    return () => clearInterval(t);
  }, [inView, reduced]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-card border border-white/10 bg-ink-raise font-mono text-[12.5px]"
    >
      <div className="flex gap-1.5 border-b border-white/10 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <i key={i} className="h-2.5 w-2.5 rounded-full bg-white/15" />
        ))}
      </div>
      <div className="min-h-[190px] px-5 py-5 leading-[2.1] text-on-ink-dim">
        {TERM_LINES.slice(0, shown).map((l, i) => (
          <div key={i}>
            {l.p && <span className="text-gold">{l.p}</span>}
            {l.t}
            {l.c && <span className="text-on-ink-dim2">{l.c}</span>}
          </div>
        ))}
        {shown < TERM_LINES.length && (
          <span className="inline-block h-4 w-2 animate-pulse bg-gold/70 align-middle" aria-hidden />
        )}
      </div>
    </div>
  );
}

export function OpenSource() {
  return (
    <section id="opensource" className="bg-ink py-28 text-on-ink">
      <div className="wrap grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <Reveal>
          <div className="mb-4 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-gold">
            <span className="h-px w-6 bg-gold/70" aria-hidden />
            Open source · self-host
          </div>
          <h2 className="font-serif text-[clamp(32px,4.4vw,50px)] leading-[1.08]">
            Your data, your servers, <i className="italic text-gold-light">your rules.</i>
          </h2>
          <p className="mt-4 max-w-[600px] text-[16.5px] leading-[1.7] text-on-ink-dim">
            Self-host the whole governed engine — free. The full thing, not a crippled community
            edition: the paid tiers sell operation and assurance, not access. Your data never has to
            leave your infrastructure, and there&rsquo;s no lock-in to fear — the asset is yours.
          </p>
          <div className="mt-6 rounded-xl border border-dashed border-white/25 px-5 py-4">
            <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-gold-light">
              Straight answers — what&rsquo;s live vs what&rsquo;s next
            </div>
            <p className="text-[13px] text-on-ink-dim">
              <b className="font-semibold text-on-ink">Live today:</b> the governed engine, per-fact
              receipts, human approval, signals and briefings, the API and SDK, self-hosting via
              Docker.
              <br />
              <b className="font-semibold text-on-ink">On the roadmap:</b> forecasting, licensed
              data feeds, webhooks, and hardened self-host GA. We will never sell you a roadmap item
              as shipped.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Terminal />
        </Reveal>
      </div>
    </section>
  );
}
