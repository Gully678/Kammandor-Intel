"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Reveal } from "./Reveal";
import { LogoMark } from "./Logo";

/**
 * Plays the HyperFrames-rendered brand film (/video/kammandor-loop.mp4).
 * If the file is absent or fails, an in-browser motion sequence of the same
 * storyboard plays instead — the section never appears broken.
 */

const FRAMES = [
  { kind: "title" as const, text: "See it coming." },
  { kind: "law" as const },
  { kind: "signal" as const },
  { kind: "close" as const },
];

function FallbackLoop() {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), 3200);
    return () => clearInterval(t);
  }, [reduced]);

  const frame = FRAMES[i];

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(250,246,238,.5) 1px,transparent 1px),linear-gradient(90deg,rgba(250,246,238,.5) 1px,transparent 1px)",
          backgroundSize: "56px 56px",
        }}
        aria-hidden
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={reduced ? false : { opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -18 }}
          transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
          className="relative px-8 text-center"
        >
          {frame.kind === "title" && (
            <div className="font-serif text-[clamp(34px,6vw,72px)] text-on-ink">
              See it <span className="italic text-gold">coming.</span>
            </div>
          )}
          {frame.kind === "law" && (
            <div className="font-mono text-[clamp(13px,2.2vw,22px)] tracking-[0.06em] text-on-ink">
              propose <span className="text-gold">→</span> evaluate{" "}
              <span className="text-gold">→</span> human-approve{" "}
              <span className="text-gold">→</span> audited-write
            </div>
          )}
          {frame.kind === "signal" && (
            <div className="mx-auto w-[min(440px,84vw)] rounded-card border border-white/15 bg-ink-raise p-5 text-left shadow-frame">
              <span className="rounded-full bg-s-red-bg px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-s-red">
                Critical
              </span>
              <div className="mt-2.5 text-[14px] leading-snug text-on-ink">
                Two watched categories matched this cycle for a monitored counterparty
              </div>
              <div className="mt-1.5 text-[11.5px] text-on-ink-dim">
                Why: sanctions-adjacent coverage + filings both moved
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-white/25 px-2.5 py-1 font-mono text-[10px] text-gold-light">
                <span className="text-[7px] text-gold">◆</span> source: GDELT · licence: open ·
                conf 0.91
              </div>
            </div>
          )}
          {frame.kind === "close" && (
            <div className="flex flex-col items-center gap-4">
              <LogoMark size={54} />
              <div className="font-serif text-[clamp(22px,3.4vw,36px)] text-on-ink">
                Kammandor <span className="italic text-gold">Intelligence</span>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-on-ink-dim2">
                Start free · the code is the demo
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
      {/* progress dots */}
      <div className="absolute bottom-4 flex gap-1.5" aria-hidden>
        {FRAMES.map((_, d) => (
          <span
            key={d}
            className={`h-1 w-4 rounded-full transition-colors duration-300 ${
              d === i ? "bg-gold" : "bg-white/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function VideoSection() {
  const [videoOk, setVideoOk] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <section className="py-28">
      <div className="wrap">
        <Reveal className="mb-10 text-center">
          <div className="eyebrow justify-center !flex items-center gap-3">
            <span className="h-px w-6 bg-gold/70" aria-hidden />
            The film
            <span className="h-px w-6 bg-gold/70" aria-hidden />
          </div>
          <h2 className="font-serif text-[clamp(32px,4.4vw,50px)] leading-[1.08]">
            Sixty seconds. <span className="italic text-gold-deep">The whole idea.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="relative mx-auto max-w-[1000px] overflow-hidden rounded-card border border-card-border shadow-frame">
            {!videoFailed && (
              <video
                className={`block w-full ${videoOk ? "" : "absolute inset-0 opacity-0"}`}
                src="/video/kammandor-loop.mp4"
                autoPlay
                muted
                loop
                playsInline
                onCanPlay={() => setVideoOk(true)}
                onError={() => setVideoFailed(true)}
              />
            )}
            {!videoOk && <FallbackLoop />}
          </div>
        </Reveal>
        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          Rendered programmatically with HyperFrames — HTML in, film out
        </p>
      </div>
    </section>
  );
}
