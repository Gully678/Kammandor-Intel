export function LogoMark({ size = 20, dots = true }: { size?: number; dots?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M6 23 L13 13 L19 18 L26 8"
        stroke="#E8A020"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="23" r="3" fill="#E8A020" />
      {dots && <circle cx="13" cy="13" r="2.6" fill="#FAF6EE" />}
      {dots && <circle cx="19" cy="18" r="2.6" fill="#FAF6EE" />}
      <circle cx="26" cy="8" r="3.4" fill="#E8A020" />
    </svg>
  );
}

export function Logo({ onInk = false }: { onInk?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-ink">
        <LogoMark size={20} />
      </span>
      <span className="leading-none">
        <span className={`font-serif text-[21px] tracking-[0.01em] ${onInk ? "text-on-ink" : "text-ink"}`}>
          Kammandor
        </span>
        <br />
        <span className={`font-mono text-[9.5px] uppercase tracking-[0.2em] ${onInk ? "text-on-ink-dim2" : "text-faint"}`}>
          Intelligence
        </span>
      </span>
    </span>
  );
}
