import type { ReactNode } from "react";

const PILL_TONES = {
  green: "text-s-green bg-s-green-bg",
  amber: "text-s-amber bg-s-amber-bg",
  red: "text-s-red bg-s-red-bg",
  grey: "text-s-grey bg-s-grey-bg",
  teal: "text-s-teal bg-s-teal-bg",
} as const;

export type PillTone = keyof typeof PILL_TONES;

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Receipt({ children }: { children: ReactNode }) {
  return <span className="receipt">{children}</span>;
}

const BTN = {
  ink: "bg-ink text-on-ink hover:-translate-y-px hover:shadow-lift",
  gold: "bg-gradient-to-br from-[#FBEFD4] to-[#F6E4BE] text-ink border border-gold-chip hover:-translate-y-px hover:shadow-lift",
  sec: "bg-card text-body border border-input-border hover:border-gold",
} as const;

export function Btn({
  variant,
  href,
  small = false,
  children,
}: {
  variant: keyof typeof BTN;
  href: string;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`group inline-flex items-center gap-2 whitespace-nowrap rounded-btn font-semibold transition-all duration-200 ${
        small ? "px-4 py-2 text-[13px]" : "px-5.5 px-6 py-3 text-sm"
      } ${BTN[variant]}`}
    >
      {children}
    </a>
  );
}

export function Arrow() {
  return <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>;
}

export function SectionHead({
  eyebrow,
  children,
  lede,
}: {
  eyebrow: string;
  children: ReactNode;
  lede?: string;
}) {
  return (
    <div className="mb-14 max-w-[720px]">
      <div className="eyebrow flex items-center gap-3">
        <span className="h-px w-6 bg-gold/70" aria-hidden />
        {eyebrow}
      </div>
      <h2 className="font-serif text-[clamp(32px,4.4vw,50px)] leading-[1.08] tracking-[0.005em]">
        {children}
      </h2>
      {lede && <p className="mt-4 max-w-[600px] text-[16.5px] leading-[1.7] text-body-2">{lede}</p>}
    </div>
  );
}

export function GoldItalic({ children }: { children: ReactNode }) {
  return <span className="font-serif italic text-gold-deep">{children}</span>;
}
