/**
 * All marketing copy in one place.
 * Source of truth: README_INTEL_ENGINE_MARKETING.md — claims discipline applies:
 * ships-today only, no client names, no invented figures, UK English.
 */

export type Severity = "critical" | "notable" | "background";

export interface Signal {
  severity: Severity;
  title: string;
  why: string;
  receipt: string;
}

export const SIGNALS: Signal[] = [
  {
    severity: "critical",
    title: "Two watched categories matched this cycle for a monitored counterparty",
    why: "Why: sanctions-adjacent coverage + filings both moved",
    receipt: "source: GDELT · licence: open · conf 0.91",
  },
  {
    severity: "notable",
    title: "New coverage on a company you watch: leadership change reported",
    why: "Why: strong match on your counterparty watchlist",
    receipt: "source: public news · licence: attribution",
  },
  {
    severity: "background",
    title: "Weak mention of a watched topic in regional press",
    why: "Why: single category, description-text only",
    receipt: "source: GDELT · licence: open · conf 0.42",
  },
  {
    severity: "notable",
    title: "A watched entity appears in a new registry filing",
    why: "Why: filings category — one strong hit",
    receipt: "source: public registry · licence: open",
  },
  {
    severity: "critical",
    title: "High-magnitude event touching a watched entity",
    why: "Why: magnitude above your 0.8 threshold",
    receipt: "source: GDELT · licence: open · conf 0.94",
  },
];

export const STATS = [
  {
    value: 30,
    suffix: " min",
    label:
      "Watch cycle. Around the clock, new information is checked against what you've told us you care about.",
    mark: "Shipped · scheduled cycle",
  },
  {
    value: 80,
    suffix: "%",
    label:
      "Evaluation pass floor every AI capability must clear before release — a bar no test suite can lower.",
    mark: "Shipped · structural floor",
  },
  {
    value: null,
    text: "Every",
    suffix: " fact",
    label:
      "Carries its source, licence, fetch-time and confidence. A fact never travels without its receipt.",
    mark: "Shipped · per-fact provenance",
  },
  {
    value: 0,
    suffix: " ways",
    label:
      "For an AI to write to your truth. Models propose; a person approves; every change is recorded.",
    mark: "Shipped · by construction",
  },
] as const;

export const STEPS = [
  {
    title: "Connect",
    body: "Bring your own records together with free public sources. A starter pack stands up a ready-made workspace for your world — finance, marketing, or general business — in one call.",
    receipt: "yours + public · licence-checked",
  },
  {
    title: "Watch",
    body: "Every 30 minutes, the engine checks new information against the things you've told it to care about — the companies, deals, clients and topics on your watchlist.",
    receipt: "30-min cycle · your watchlist",
  },
  {
    title: "Signal",
    body: "When something matters, you get an alert graded by seriousness, with the reason attached in plain language — and the receipt: the source behind the claim.",
    receipt: "severity: rules, not model whim",
  },
  {
    title: "Approve",
    body: "Nothing becomes part of your trusted picture until you say so. The AI proposes; you decide; every decision is recorded, forever.",
    receipt: "writer: you · trail: permanent",
  },
];

export const PILLARS = [
  {
    no: "01",
    title: "An AI cannot write to your truth",
    pill: { label: "Structural", tone: "green" as const },
    proof:
      "Models and agents can only propose. One governed path — approved by a person — is the sole way anything becomes a durable fact. Not a permission setting; the only door that exists.",
    receipt: "sole governed writer",
  },
  {
    no: "02",
    title: "Receipts on every fact",
    pill: { label: "Structural", tone: "green" as const },
    proof:
      "Every single fact carries its source, its licence class and terms, when it was fetched, and a confidence score. Check the source before you act — every time.",
    receipt: "per-fact source + licence",
  },
  {
    no: "03",
    title: "Your data is walled off in the database itself",
    pill: { label: "Data-layer", tone: "teal" as const },
    proof:
      "Isolation between customers is enforced at the data layer — not left to application code, which is where the naive pattern leaks. Each organisation sees only its own world.",
    receipt: "isolation in the database",
  },
  {
    no: "04",
    title: "Every change is versioned, forever",
    pill: { label: "Structural", tone: "green" as const },
    proof:
      "Each object keeps its history: who changed it, when, and what it looked like before and after. An audit trail you can rely on when it counts.",
    receipt: "full change history",
  },
  {
    no: "05",
    title: "Value that compounds — and stays yours",
    pill: { label: "Open", tone: "amber" as const },
    proof:
      "The connected picture of your business deepens with every approved fact. It lives on your terms — open source, exportable, self-hostable — so the asset that compounds belongs to you, not to a vendor.",
    receipt: "your asset · not the vendor's",
  },
];

export const COMPARISON = [
  {
    dim: "who it's for",
    them: "Enterprise and government — Fortune-500 and national-security budgets",
    us: "5-to-500-person businesses: the small manufacturer, the owner-operator, the family office",
  },
  {
    dim: "how you get it",
    them: "Multi-year procurement, dedicated deployment engineers",
    us: "Self-serve. Start free today, run it yourself, upgrade when you want it managed",
  },
  {
    dim: "the core idea",
    them: "“Ontology” as insider vocabulary",
    us: "Your data, connected — with a receipt behind every fact. Plain language; depth behind a hint",
  },
  {
    dim: "governance",
    them: "A capability you configure",
    us: "On by default, governed-by-construction — an AI structurally cannot write to your truth",
  },
  {
    dim: "provenance",
    them: "Action-level and pipeline-level — who changed a record, which build produced a dataset",
    us: "Per-fact source and licence, fetch-time and confidence, on every single fact",
  },
  {
    dim: "trust in the AI",
    them: "An enterprise MLOps team stands behind it",
    us: "A show-raw trace on every agent run, plus an 80% eval floor you can see — AI you can audit",
  },
  {
    dim: "source model",
    them: "Closed, proprietary",
    us: "Open source to start; self-hostable; no crippled community edition",
  },
  {
    dim: "the price frame",
    them: "The platform you can't afford",
    us: "The hire you can't make — priced against a junior analyst's salary, not an enterprise contract",
  },
  {
    dim: "first contact",
    them: "Demos gated behind sales",
    us: "Clone it, read the docs, run it. The code is the demo",
  },
];

export const TIERS = [
  {
    name: "Self-host",
    price: "Free",
    sub: "Open source, on your infrastructure",
    features: [
      "The full governed engine — nothing crippled",
      "Receipts, approvals, audit trail: all on by default",
      "Free public data sources included",
      "Community docs — the code is the demo",
    ],
    cta: "Get the code",
    highlight: false,
  },
  {
    name: "Managed",
    price: "Announced at launch",
    sub: "We run it; you decide",
    features: [
      "Everything in Self-host, hosted and looked after",
      "Scales with your monitored entities",
      "Upgrades, backups and monitoring handled",
      "Support from the team that built it",
    ],
    cta: "Join the launch list",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Let's talk",
    sub: "Scale, assurance, and a direct line",
    features: [
      "For regulated and multi-team environments",
      "Assurance, onboarding and priority support",
      "Volume monitoring across portfolios",
      "A governed-intelligence walkthrough with our team",
    ],
    cta: "Book a walkthrough",
    highlight: false,
  },
];
