import { Reveal, Stagger, StaggerItem } from "./Reveal";
import { Btn, Arrow, SectionHead, GoldItalic } from "./ui";

const VERTICALS = [
  {
    brand: "Kammandor Intel — finance & private capital",
    title: "For family offices, funds and private-capital teams",
    pain: "“Exposure discovered a week late, in a spreadsheet. Five systems to screen one deal. Every AI number has to be defensible to a regulator.”",
    points: [
      "Be told the moment something crosses a line — and see exactly why",
      "Every fact cited, with source and licence; every write approved by a person",
      "An audit trail a regulator can rely on, by construction",
    ],
    cta: { label: "Book a governed-intelligence walkthrough", href: "#contact", variant: "ink" as const },
  },
  {
    brand: "INVRT Intel — for the business you actually run",
    title: "For every SME with no data team, no analyst, no time",
    pain: "“There's no analyst. There's no budget for one. The Monday-morning picture is you, late on a Sunday — and you still can't trust an AI enough to act on it.”",
    points: [
      "The hire you can't make: your suppliers, customers, competitors and market — watched around the clock",
      "Plain English, no jargon: what happened, why it matters, and the source behind it",
      "A ready-made workspace for your business in one call — start free, run it yourself",
    ],
    cta: { label: "Start free", href: "#pricing", variant: "gold" as const },
  },
];

export function Verticals() {
  return (
    <section id="verticals" className="pb-28">
      <div className="wrap">
        <Reveal>
          <SectionHead eyebrow="Built for your world">
            One engine. <GoldItalic>Two front doors.</GoldItalic>
          </SectionHead>
        </Reveal>

        <Stagger className="grid gap-4 md:grid-cols-2">
          {VERTICALS.map((v) => (
            <StaggerItem key={v.brand} className="h-full">
              <div className="flex h-full flex-col rounded-card border border-card-border bg-card p-8 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lift">
                <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-gold-text">
                  {v.brand}
                </div>
                <h3 className="mb-3.5 font-serif text-[25px] leading-[1.2]">{v.title}</h3>
                <p className="mb-4 font-serif text-[16.5px] italic leading-[1.55] text-muted">
                  {v.pain}
                </p>
                <ul className="mb-7 flex flex-1 flex-col gap-2.5">
                  {v.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[13.5px] text-body-2">
                      <span className="mt-1.5 flex-none text-[8px] text-gold">◆</span>
                      {p}
                    </li>
                  ))}
                </ul>
                <div>
                  <Btn variant={v.cta.variant} href={v.cta.href}>
                    {v.cta.label} <Arrow />
                  </Btn>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal delay={0.15}>
          <p className="mt-5 text-center text-[12.5px] text-faint">
            Also built for agencies and marketing teams — every client watched from one place, each
            fully walled off from the next.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
