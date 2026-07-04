"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Btn, Arrow } from "./ui";

const TAGS = ["The governed intelligence layer", "Start free · self-host", "Human-approved AI"];

const TICKS = ["A receipt behind every fact", "Self-hostable today", "No procurement cycle"];

export function Hero() {
  const reduced = useReducedMotion();
  const up = (delay: number) => ({
    initial: reduced ? undefined : { opacity: 0, y: 28 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.8, delay, ease: [0.2, 0.7, 0.2, 1] as const },
  });

  return (
    <header id="top" className="px-6 pb-16 pt-[150px] text-center">
      <motion.div {...up(0.05)} className="mb-7 flex flex-wrap justify-center gap-2">
        {TAGS.map((t) => (
          <span key={t} className="tagchip">
            {t}
          </span>
        ))}
      </motion.div>

      <h1 className="mb-6 font-serif text-[clamp(52px,8.6vw,112px)] leading-[1.02] tracking-[0.005em]">
        <motion.span {...up(0.15)} className="inline-block">
          See it{" "}
        </motion.span>{" "}
        <motion.span {...up(0.3)} className="inline-block italic text-gold-deep">
          coming.
        </motion.span>
      </h1>

      <motion.p
        {...up(0.45)}
        className="mx-auto mb-9 max-w-[640px] text-[clamp(16px,2vw,18.5px)] leading-[1.7] text-body-2"
      >
        The governed intelligence layer that turns your data into signals you can trust — and act
        on. AI does the watching; a person approves every change; every answer shows its sources.
        Start free, run it yourself, grow into managed.
      </motion.p>

      <motion.div {...up(0.6)} className="flex flex-wrap justify-center gap-3">
        <Btn variant="ink" href="#pricing">
          Start Free <Arrow />
        </Btn>
        <Btn variant="sec" href="#how">
          See How It Works
        </Btn>
      </motion.div>

      <motion.div
        {...up(0.75)}
        className="mt-6 flex flex-wrap justify-center gap-5 text-[13px] text-muted"
      >
        {TICKS.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="font-bold text-s-green">✓</span> {t}
          </span>
        ))}
      </motion.div>
    </header>
  );
}
