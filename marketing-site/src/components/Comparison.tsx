import { COMPARISON } from "@/lib/content";
import { Reveal } from "./Reveal";
import { SectionHead, GoldItalic } from "./ui";

export function Comparison() {
  return (
    <section id="compare" className="pb-28">
      <div className="wrap">
        <Reveal>
          <SectionHead eyebrow="A different kind of platform">
            The same mechanisms. <GoldItalic>Finally within reach.</GoldItalic>
          </SectionHead>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="overflow-x-auto rounded-card border border-card-border bg-card shadow-card">
            <table className="w-full min-w-[760px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="bg-table-head font-mono text-[10px] uppercase tracking-[0.16em]">
                  <th className="px-5 py-4 font-medium" />
                  <th className="px-5 py-4 font-medium text-faint">
                    Enterprise intelligence platforms
                  </th>
                  <th className="px-5 py-4 font-medium text-gold-text">Kammandor Intelligence</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.dim}
                    className={`group align-top transition-colors hover:bg-hover-row ${
                      i > 0 ? "border-t border-divide" : "border-t border-divide"
                    }`}
                  >
                    <td className="w-[140px] px-5 py-4 font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
                      {row.dim}
                    </td>
                    <td className="px-5 py-4 text-muted">{row.them}</td>
                    <td className="border-l border-gold-chip bg-gold/5 px-5 py-4 text-body transition-colors group-hover:bg-gold/10">
                      {row.us}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <p className="mt-8 max-w-[780px] font-serif text-[clamp(18px,2.4vw,23px)] leading-[1.5] text-body-2">
            The mechanisms are proven at small-business scale in the incumbent&rsquo;s own training
            material — but the platform is only sold to the Fortune 500.{" "}
            <i className="text-gold-deep">We built the governed version a small team can actually run.</i>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
