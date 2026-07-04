import { Reveal } from "./Reveal";
import { Btn, Arrow } from "./ui";
import { Logo } from "./Logo";

export function Manifesto() {
  return (
    <section id="about" className="px-6 pb-32 pt-6 text-center">
      <Reveal>
        <div className="mb-4 flex items-center justify-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-gold-text">
          <span className="h-px w-6 bg-gold/70" aria-hidden />
          Why we built it
          <span className="h-px w-6 bg-gold/70" aria-hidden />
        </div>
        <p className="mx-auto max-w-[860px] font-serif text-[clamp(28px,4.4vw,48px)] leading-[1.2]">
          The capability was always real. The access wasn&rsquo;t.{" "}
          <span className="italic text-gold-deep">Until now.</span>
        </p>
        <p className="mx-auto mt-6 max-w-[560px] text-sm text-muted">
          Governed intelligence for the people who actually run the world&rsquo;s businesses — the
          five-person firm, the owner-operator, the family office.
        </p>
      </Reveal>
    </section>
  );
}

export function FinalCta() {
  return (
    <section id="contact" className="bg-ink px-6 py-28 text-center text-on-ink">
      <Reveal>
        <h2 className="mb-4 font-serif text-[clamp(32px,4.4vw,50px)] leading-[1.08]">
          See it <span className="italic text-gold-light">coming.</span>
        </h2>
        <p className="mx-auto mb-9 max-w-[600px] text-[16.5px] leading-[1.7] text-on-ink-dim">
          Start free and self-hosted today — no sales call, no procurement cycle. Or book a
          walkthrough and see the governed layer on data like yours.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Btn variant="gold" href="#pricing">
            Start Free <Arrow />
          </Btn>
          <a
            href="#verticals"
            className="group inline-flex items-center gap-2 rounded-btn border border-white/25 px-6 py-3 text-sm font-semibold text-on-ink transition-colors hover:border-gold"
          >
            Book a governed-intelligence walkthrough
          </a>
        </div>
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-topbar-border py-13 py-12">
      <div className="wrap">
        <div className="flex flex-wrap justify-between gap-8">
          <div>
            <a href="#top" aria-label="Back to top">
              <Logo />
            </a>
            <p className="mt-3.5 max-w-[300px] text-[12.5px] text-faint">
              The governed intelligence layer. Your data, connected — with a receipt behind every
              fact.
            </p>
          </div>
          <div className="flex flex-wrap gap-16">
            {[
              {
                h: "Product",
                links: [
                  ["#how", "How it works"],
                  ["#governance", "Governance & trust"],
                  ["#opensource", "Open source"],
                  ["#pricing", "Pricing"],
                ],
              },
              {
                h: "Solutions",
                links: [
                  ["#verticals", "Finance & private capital"],
                  ["#verticals", "SME & owner-operators"],
                ],
              },
              {
                h: "Developers",
                links: [
                  ["#opensource", "Self-host quickstart"],
                  ["#opensource", "API & SDK docs"],
                ],
              },
            ].map((col) => (
              <div key={col.h}>
                <h4 className="mb-3 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-faint">
                  {col.h}
                </h4>
                {col.links.map(([href, label]) => (
                  <a
                    key={label}
                    href={href}
                    className="mb-2 block text-[13px] text-body-2 transition-colors hover:text-ink"
                  >
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-4 border-t border-divide pt-5 text-xs text-faint">
          <span>© 2026 INVRT. All rights reserved.</span>
          <span className="font-mono text-[10px] tracking-[0.08em]">
            EVERY FACT · SOURCE + LICENCE ATTACHED
          </span>
        </div>
      </div>
    </footer>
  );
}
