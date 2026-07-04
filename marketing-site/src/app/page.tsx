import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ProductFrame } from "@/components/ProductFrame";
import { StatBand } from "@/components/StatBand";
import { Statement } from "@/components/Statement";
import { VideoSection } from "@/components/VideoSection";
import { HowItWorks } from "@/components/HowItWorks";
import { Governance } from "@/components/Governance";
import { AuditSection } from "@/components/AuditSection";
import { Comparison } from "@/components/Comparison";
import { Verticals } from "@/components/Verticals";
import { OpenSource } from "@/components/OpenSource";
import { Pricing } from "@/components/Pricing";
import { Manifesto, FinalCta, Footer } from "@/components/Closing";
import { Reveal } from "@/components/Reveal";

export default function Home() {
  return (
    <main>
      <Nav />
      <Hero />

      {/* the product, full width — the demo IS the pitch */}
      <div className="px-6 pb-24 pt-6">
        <Reveal>
          <div className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-gold-text">
            It&rsquo;s 7:04 on a Monday. <b className="font-medium text-body">This is already waiting for you.</b>
          </div>
          <ProductFrame />
        </Reveal>
      </div>

      <StatBand />
      <Statement />
      <VideoSection />
      <HowItWorks />
      <Governance />
      <AuditSection />
      <Comparison />
      <Verticals />
      <OpenSource />
      <Pricing />
      <Manifesto />
      <FinalCta />
      <Footer />
    </main>
  );
}
