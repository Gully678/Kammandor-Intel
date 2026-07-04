"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { Btn } from "./ui";

const LINKS = [
  ["#how", "How it works"],
  ["#governance", "Governance"],
  ["#compare", "Comparison"],
  ["#verticals", "Solutions"],
  ["#opensource", "Open source"],
  ["#pricing", "Pricing"],
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={`fixed inset-x-0 top-0 z-50 backdrop-blur-md transition-colors duration-300 ${
        scrolled ? "border-b border-topbar-border" : "border-b border-transparent"
      }`}
      style={{ backgroundColor: "rgba(236,229,215,.92)" }}
    >
      <div className="wrap flex h-[66px] items-center gap-8">
        <a href="#top" aria-label="Kammandor Intelligence — home">
          <Logo />
        </a>
        <div className="ml-auto hidden gap-6 text-[13.5px] text-body-2 lg:flex">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </div>
        <div className="ml-1.5 flex gap-2">
          <span className="hidden sm:inline-flex">
            <Btn variant="sec" href="#how" small>
              See How It Works
            </Btn>
          </span>
          <Btn variant="ink" href="#pricing" small>
            Start Free
          </Btn>
        </div>
      </div>
    </motion.nav>
  );
}
