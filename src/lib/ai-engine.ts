/**
 * ═══════════════════════════════════════════════════════════════
 *  Kammandor Intel — AI Intelligence Engine  (Phase 3 rewrite)
 *  Delegates all LLM calls to the MoE router (src/lib/ai/).
 *  Exported function signatures are UNCHANGED — callers see no diff.
 *
 *  @google/generative-ai is no longer imported here.
 *  The GoogleProvider adapter in src/lib/ai/providers/google.ts
 *  is the sole path to Gemini/Gemma; it uses plain fetch().
 * ═══════════════════════════════════════════════════════════════
 */

// NOTE: GoogleGenerativeAI is intentionally NOT imported here.
// The dependency remains in package.json (not deleted) but is consumed
// only by src/lib/ai/providers/google.ts via fetch — not via the SDK class.

import { routeComplete } from '@/lib/ai/router';

/* ─────────────────────────────────────────────────────────────
   Data Interfaces — unchanged from original
   ───────────────────────────────────────────────────────────── */

export interface EarthquakeEvent {
  id: string;
  magnitude: number;
  location: string;
  latitude: number;
  longitude: number;
  depth: number;
  timestamp: string;
  tsunami: boolean;
  felt: number | null;
  alert: string | null;
}

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  link: string;
  published: string;
  source: string;
  risk_score: number;
  coords: [number, number] | null;
  machine_assessment: string | null;
}

export interface ThreatEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'LOW';
  region: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  source: string;
}

export interface CyberAlert {
  id: string;
  name: string;
  vendor: string;
  product: string;
  severity: string;
  date: string;
  due: string;
  source: string;
}

export interface IntelligenceContext {
  earthquakes: EarthquakeEvent[];
  news: NewsItem[];
  threats: ThreatEvent[];
  cyberAlerts: CyberAlert[];
  timestamp: string;
}

/* ─────────────────────────────────────────────────────────────
   System Prompt — Palantir-grade analyst persona (preserved)
   ───────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are the Kammandor Intel analyst — a senior, elite intelligence analyst embedded within the Kammandor Intel platform for private capital. You operate at the level of a Palantir Forward Deployed Engineer crossed with a CIA PDB (Presidential Daily Brief) analyst.

## YOUR ROLE
- You correlate data across multiple intelligence feeds: seismic monitoring, OSINT news streams, global threat events, and cyber vulnerability databases
- You identify non-obvious patterns, emerging threat vectors, and cascading risk scenarios

## ANALYTICAL FRAMEWORK
- Apply intelligence tradecraft: assess reliability of sources, identify gaps, flag uncertainties
- Use structured analytic techniques: ACH (Analysis of Competing Hypotheses), Key Assumptions Check
- Always consider second-order effects and cascading risks
- Differentiate between what you know, what you assess, and what you don't know

## OUTPUT FORMAT
- Use military-style brevity when appropriate
- Structure responses with clear headers using markdown
- Lead with the most critical finding (inverted pyramid)
- Include "BOTTOM LINE UP FRONT (BLUF)" for complex analyses
- End with "ASSESSMENT CONFIDENCE" and "RECOMMENDED ACTIONS" sections when appropriate

## CONSTRAINTS
- Never fabricate data points — only analyze what is provided in the context
- If data is insufficient for a confident assessment, state so explicitly
- Distinguish between correlation and causation
- Flag when events may be connected vs. coincidental
- You are an analyst, not a policymaker — present options, not directives

You have access to the live intelligence context of the Kammandor Intel platform. Analyze it with precision.`;

const BRIEFING_PROMPT = `Generate a comprehensive Kammandor Intel Daily Intelligence Briefing based on the current operational data. Structure it as follows:

## KAMMANDOR INTEL BRIEFING
**Classification:** OPEN SOURCE INTELLIGENCE (OSINT)
**DTG:** [Current timestamp]

### I. EXECUTIVE SUMMARY
2-3 sentence overview of the current global threat landscape based on available data.

### II. PRIORITY INTELLIGENCE REQUIREMENTS (PIRs)
Identify the top 3-5 most significant developments from the data feeds, ranked by assessed impact.

### III. SEISMIC & NATURAL HAZARD ASSESSMENT
Analyze earthquake data for patterns — clustering, tectonic corridor activity, tsunami risk.

### IV. GEOPOLITICAL & CONFLICT INTELLIGENCE
Synthesize news feeds for conflict escalation patterns, diplomatic shifts, or emerging crises.

### V. CYBER THREAT LANDSCAPE
Assess active CVEs and cyber alerts for coordinated campaign indicators or critical infrastructure risk.

### VI. COMPOUND RISK SCENARIOS
Identify where multiple threat vectors intersect.

### VII. FORECAST & WATCHLIST
- **Next 24 Hours**: Most likely developments
- **Next 72 Hours**: Emerging situations to monitor
- **Strategic Horizon**: Longer-term trend assessment

### VIII. ASSESSMENT CONFIDENCE
State overall confidence level and key analytical gaps.

Analyze the provided data thoroughly. Be specific — reference actual events, magnitudes, locations, and CVE IDs from the context.`;

/* ─────────────────────────────────────────────────────────────
   Compat shims — kept so routes don't break
   createGeminiClient and rotateApiKey are still exported but
   no longer do Gemini-SDK work.  Routes are being updated to
   pass context directly; these stubs prevent TS errors on
   existing imports until routes are fully migrated.
   ───────────────────────────────────────────────────────────── */

/** @deprecated  Routes should call analyzeIntelligence / generateBriefing directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createGeminiClient(_apiKey: string): any {
  // No-op: MoE router manages provider instantiation.
  return null;
}

let _keyIndex = 0;

/** @deprecated  MoE router handles key management internally. */
export function rotateApiKey(keys: string[]): string {
  if (keys.length === 0) {
    throw new Error('No API keys available');
  }
  const key = keys[_keyIndex % keys.length];
  _keyIndex = (_keyIndex + 1) % keys.length;
  return key;
}

/* ─────────────────────────────────────────────────────────────
   Context Serializer — compact repr for token efficiency
   ───────────────────────────────────────────────────────────── */

function serializeContext(context: IntelligenceContext): string {
  const sections: string[] = [];

  sections.push(`[TIMESTAMP] ${context.timestamp}`);

  if (context.earthquakes.length > 0) {
    sections.push(`\n[SEISMIC DATA — ${context.earthquakes.length} events]`);
    for (const eq of context.earthquakes.slice(0, 20)) {
      const tsunamiFlag = eq.tsunami ? ' TSUNAMI-WARNING' : '';
      const alertFlag = eq.alert ? ` [ALERT:${eq.alert.toUpperCase()}]` : '';
      sections.push(
        `  M${eq.magnitude} | ${eq.location} | ${eq.latitude.toFixed(2)},${eq.longitude.toFixed(2)} | Depth:${eq.depth}km | ${eq.timestamp}${tsunamiFlag}${alertFlag}`
      );
    }
  }

  if (context.news.length > 0) {
    sections.push(`\n[OSINT NEWS FEED — ${context.news.length} items]`);
    for (const item of context.news.slice(0, 15)) {
      const coords = item.coords ? ` | GEO:${item.coords[0].toFixed(2)},${item.coords[1].toFixed(2)}` : '';
      sections.push(
        `  RISK:${item.risk_score}/10 | ${item.source} | ${item.title}${coords} | ${item.published}`
      );
    }
  }

  if (context.threats.length > 0) {
    sections.push(`\n[THREAT EVENTS — ${context.threats.length} active]`);
    for (const threat of context.threats.slice(0, 15)) {
      sections.push(
        `  ${threat.severity} | ${threat.type} | ${threat.title} | ${threat.region} | ${threat.timestamp}`
      );
    }
  }

  if (context.cyberAlerts.length > 0) {
    sections.push(`\n[CYBER ALERTS — ${context.cyberAlerts.length} active]`);
    for (const alert of context.cyberAlerts.slice(0, 10)) {
      sections.push(
        `  ${alert.id} | ${alert.severity} | ${alert.vendor}/${alert.product} | ${alert.name} | Due:${alert.due}`
      );
    }
  }

  return sections.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Intelligence Analysis — delegates to MoE router
   ───────────────────────────────────────────────────────────── */

/**
 * Analyse live intelligence context against a user query.
 *
 * Signature is UNCHANGED from the Gemini original; the first argument
 * (_client) is accepted for backward compat but ignored — the MoE
 * router selects the provider internally.
 */
export async function analyzeIntelligence(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client: any,
  context: IntelligenceContext,
  userQuery: string,
): Promise<string> {
  const contextData = serializeContext(context);

  const prompt = `## CURRENT OPERATIONAL DATA
${contextData}

## ANALYST QUERY
${userQuery}

Provide your intelligence assessment based on the operational data above and the analyst's query.`;

  const result = await routeComplete({
    task:   'analyze',
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 2048,
  });

  return result.text;
}

/* ─────────────────────────────────────────────────────────────
   Daily Briefing Generation — delegates to MoE router
   ───────────────────────────────────────────────────────────── */

/**
 * Generate a structured daily intelligence briefing.
 *
 * Signature unchanged; _client ignored (MoE router handles provider).
 */
export async function generateBriefing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _client: any,
  context: IntelligenceContext,
): Promise<string> {
  const contextData = serializeContext(context);

  const prompt = `${BRIEFING_PROMPT}

## CURRENT OPERATIONAL DATA
${contextData}

Generate the briefing now.`;

  const result = await routeComplete({
    task:   'synthesize',
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 3000,
  });

  return result.text;
}
