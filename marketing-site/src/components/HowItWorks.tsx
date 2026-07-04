import { STEPS } from "@/lib/content";
import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { Receipt, SectionHead, GoldItalic } from "./ui";

export function HowItWorks() {
  return (
    <section id="how" className="pb-28 pt-24">
      <div className="wrap">
        <Reveal>
          <SectionHead
            eyebrow="How it works"
            lede="One loop, in plain language. No jargon required to run it — and full depth behind every hint when you want it."
          >
            Connect. Watch. Signal. <GoldItalic>Approve.</GoldItalic>
          </SectionHead>
        </Reveal>

        <Stagger className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <StaggerItem key={s.title}>
              <div className="group h-full rounded-card border border-card-border bg-card p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
                <div className="mb-4 font-mono text-[11px] tracking-[0.14em] text-gold-text">
                  0{i + 1}
                </div>
                <h3 className="mb-2 font-serif text-[22px] leading-tight">{s.title}</h3>
                <p className="text-[13.5px] text-body-2">{s.body}</p>
                <div className="mt-3.5">
                  <Receipt>{s.receipt}</Receipt>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal delay={0.15}>
          <div className="mt-11 rounded-card bg-ink px-7 py-6 text-center">
            <div className="font-mono text-[clamp(11px,1.7vw,14px)] tracking-[0.06em] text-on-ink">
              propose <span className="text-gold">→</span> evaluate{" "}
              <span className="text-gold">→</span> human-approve{" "}
              <span className="text-gold">→</span> audited-write
            </div>
            <div className="mt-2 text-[12.5px] text-on-ink-dim2">
              The one path every fact must take. There is no other door.
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
