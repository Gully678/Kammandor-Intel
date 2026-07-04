"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";

const LINES: { text: React.ReactNode; className?: string }[] = [
  {
    text: "Right now, somewhere in your world",
    className:
      "font-mono text-[12px] uppercase tracking-[0.18em] text-faint mb-7 !leading-normal",
  },
  {
    text: (
      <>
        A counterparty moved. A client wobbled.
        <br />A competitor shipped. A rule changed.
      </>
    ),
  },
  {
    text: (
      <>
        You&rsquo;ll find out <span className="italic text-gold-deep">in ten days</span> — in a
        spreadsheet.
      </>
    ),
  },
  {
    text: (
      <span className="text-faint">
        Unless someone was watching. Someone who never sleeps, never guesses,
        <br className="hidden md:block" /> and shows you the source behind every word.
      </span>
    ),
  },
];

function Line({
  progress,
  range,
  children,
  className,
}: {
  progress: MotionValue<number>;
  range: [number, number];
  children: React.ReactNode;
  className?: string;
}) {
  const opacity = useTransform(progress, [range[0], range[1]], [0.08, 1]);
  const y = useTransform(progress, [range[0], range[1]], [26, 0]);
  return (
    <motion.p
      style={{ opacity, y }}
      className={
        className ??
        "mx-auto max-w-[940px] font-serif text-[clamp(28px,4.6vw,52px)] leading-[1.22]"
      }
    >
      {children}
    </motion.p>
  );
}

export function Statement() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.5"],
  });
  const pivotOpacity = useTransform(scrollYProgress, [0.82, 1], [0, 1]);

  if (reduced) {
    return (
      <section id="problem" className="px-6 py-32 text-center">
        {LINES.map((l, i) => (
          <p
            key={i}
            className={
              l.className ??
              "mx-auto mt-1.5 max-w-[940px] font-serif text-[clamp(28px,4.6vw,52px)] leading-[1.22]"
            }
          >
            {l.text}
          </p>
        ))}
        <div className="mt-11 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-text">
          That is what the governed intelligence layer is for
        </div>
      </section>
    );
  }

  return (
    <section id="problem" ref={ref} className="px-6 py-32 text-center">
      <div className="space-y-1.5">
        {LINES.map((l, i) => (
          <Line
            key={i}
            progress={scrollYProgress}
            range={[i * 0.2, i * 0.2 + 0.25]}
            className={
              l.className
                ? `mx-auto max-w-[940px] ${l.className}`
                : undefined
            }
          >
            {l.text}
          </Line>
        ))}
      </div>
      <motion.div
        style={{ opacity: pivotOpacity }}
        className="mt-11 font-mono text-[11px] uppercase tracking-[0.2em] text-gold-text"
      >
        That is what the governed intelligence layer is for
      </motion.div>
    </section>
  );
}
