import { PILLARS } from "@/lib/content";
import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { Pill, Receipt, SectionHead, GoldItalic } from "./ui";

export function Governance() {
  return (
    <section id="governance" className="pb-28">
      <div className="wrap">
        <Reveal>
          <SectionHead
            eyebrow="Governance — the moat"
            lede="Five guarantees, each one structural — built into how the system works, not bolted on as a setting someone could switch off."
          >
            Trust isn&rsquo;t a policy here. <GoldItalic>It&rsquo;s the architecture.</GoldItalic>
          </SectionHead>
        </Reveal>

        <Stagger className="overflow-hidden rounded-card border border-card-border shadow-card">
          {PILLARS.map((p, i) => (
            <StaggerItem key={p.no}>
              <div
                className={`grid gap-3 bg-card px-7 py-7 transition-colors hover:bg-hover-row md:grid-cols-[56px_1fr_1.25fr] md:gap-6 ${
                  i > 0 ? "border-t border-card-border" : ""
                }`}
              >
                <div className="pt-1 font-mono text-[12px] text-gold-text">{p.no}</div>
                <div>
                  <h3 className="font-serif text-[21px] leading-[1.25]">{p.title}</h3>
                  <div className="mt-2">
                    <Pill tone={p.pill.tone}>{p.pill.label}</Pill>
                  </div>
                </div>
                <div className="text-[13.5px] text-body-2">
                  {p.proof}
                  <div className="mt-2.5">
                    <Receipt>{p.receipt}</Receipt>
                  </div>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
