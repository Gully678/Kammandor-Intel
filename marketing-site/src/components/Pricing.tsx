import { TIERS } from "@/lib/content";
import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { Btn, Arrow, SectionHead, GoldItalic } from "./ui";

export function Pricing() {
  return (
    <section id="pricing" className="py-28">
      <div className="wrap">
        <Reveal>
          <SectionHead
            eyebrow="Pricing"
            lede="Plans scale with the entities you monitor — the companies, deals, clients and topics you have the engine watch. Start free; pay only when you want it managed, or need scale and assurance."
          >
            Priced against the hire you can&rsquo;t make —{" "}
            <GoldItalic>not the platform you can&rsquo;t afford.</GoldItalic>
          </SectionHead>
        </Reveal>

        <Stagger className="grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <StaggerItem key={t.name} className="h-full">
              <div
                className={`flex h-full flex-col rounded-card border bg-card p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift ${
                  t.highlight ? "border-gold shadow-gold-glow" : "border-card-border shadow-card"
                }`}
              >
                <div
                  className={`mb-3.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
                    t.highlight ? "text-gold-text" : "text-faint"
                  }`}
                >
                  {t.name}
                </div>
                <div className="font-serif text-[30px] leading-tight">{t.price}</div>
                <div className="mb-5 mt-1 text-[12.5px] text-faint">{t.sub}</div>
                <ul className="mb-7 flex flex-1 flex-col gap-2.5">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[13.5px] text-body-2">
                      <span className="flex-none font-bold text-s-green">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div>
                  <Btn variant={t.highlight ? "ink" : "sec"} href="#contact">
                    {t.cta} <Arrow />
                  </Btn>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal delay={0.15}>
          <p className="mt-8 text-center text-sm text-muted">
            No procurement cycle to get value.{" "}
            <i className="font-serif text-base text-body-2">
              Start free today; grow into managed when you&rsquo;re ready.
            </i>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
