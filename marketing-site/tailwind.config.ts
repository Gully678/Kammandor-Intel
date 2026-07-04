import type { Config } from "tailwindcss";

/**
 * Kammandor house design tokens — mapped 1:1 from
 * Design Folder/KAMMANDOR_DESIGN_SCHEMA.md §1–§3.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16141C",
        "ink-tile": "#2A2632",
        "ink-raise": "#1B1822",
        page: "#ECE5D7",
        card: "#FFFDF8",
        "card-border": "#EAE2D2",
        "input-border": "#E6DECE",
        divide: "#EFE7D8",
        "table-head": "#F7F1E5",
        "hover-row": "#FBF7EE",
        tint: "#F2EADB",
        "tint-deep": "#F3ECDD",
        "topbar-border": "#DDD2BC",
        gold: "#E8A020",
        "gold-deep": "#C47D0E",
        "gold-light": "#F5BC4A",
        "gold-text": "#9A7B1C",
        "gold-chip": "#F1DDA8",
        body: "#1A1820",
        "body-2": "#4A443D",
        muted: "#6F665D",
        faint: "#8A8175",
        "faint-2": "#9A938A",
        "on-ink": "#FAF6EE",
        "on-ink-dim": "#C8BFB1",
        "on-ink-dim2": "#9C9088",
        "s-green": "#15803D",
        "s-green-bg": "#E2F4EC",
        "s-amber": "#9A6B07",
        "s-amber-bg": "#FBF0D8",
        "s-red": "#C0392B",
        "s-red-bg": "#FBE7E3",
        "s-grey": "#6F665D",
        "s-grey-bg": "#F0E9DA",
        "s-teal": "#0D7D74",
        "s-teal-bg": "#D7F0EC",
        pulse: "#0E9F6E",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Menlo", "monospace"],
      },
      borderRadius: {
        card: "16px",
        tile: "13px",
        btn: "10px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(40,30,10,.04)",
        lift: "0 3px 14px rgba(232,160,32,.16)",
        frame: "0 24px 60px rgba(20,16,10,.18)",
        "gold-glow": "0 3px 20px rgba(232,160,32,.14)",
      },
      maxWidth: {
        site: "1180px",
      },
    },
  },
  plugins: [],
};

export default config;
