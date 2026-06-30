"""
KINTEL Workers — LangGraph Governed-Analysis Graph

Governance boundary (enforced by architecture):
  ┌──────────┐    ┌────────┐    ┌─────────┐    ┌─────────┐
  │ retrieve │───▶│ reason │───▶│ propose │───▶│ persist │
  └──────────┘    └────────┘    └─────────┘    └─────────┘
       ▲                                             │
  (Supabase                                   ONLY writer:
   intel schema                            intel.proposed_edit
   — read only)                              status='pending'
                                                     │
                                              Human approves
                                                     │
                                          Application layer applies
                                          to intel.entity / intel.link

The LLM PROPOSES; humans APPROVE; the application layer APPLIES.
This graph NEVER writes to intel.entity or intel.link directly.

Heavy imports (langgraph, langchain-core, supabase) are lazy-loaded
inside functions so the FastAPI app can import graph.py without them
installed (they are installed by Render at deploy time).
"""

from __future__ import annotations

import os
from typing import Any, Optional

from .moe import route_complete
from .ontology import propose_create_entity, propose_create_link

# ---------------------------------------------------------------------------
# Graph state — plain TypedDict (no langgraph dep at module level)
# ---------------------------------------------------------------------------


def _build_graph():
    """
    Build and compile the LangGraph analysis graph.
    Lazy-imports langgraph so the module can load without it installed.
    """
    # --- lazy imports ---
    try:
        from langgraph.graph import StateGraph, END           # type: ignore
        from typing import TypedDict
    except ImportError as exc:
        raise RuntimeError(
            "langgraph is not installed. "
            "It is listed in requirements.txt and installed by Render at deploy. "
            f"Original error: {exc}"
        ) from exc

    class AnalysisState(TypedDict, total=False):
        tenant_id:     str
        objective:     str
        entity_ids:    list[str]
        entities:      list[dict]          # retrieved from Supabase
        narrative:     str                 # LLM synthesis output
        proposed_edits: list[dict]         # ProposedEdit dicts (not yet persisted)
        proposed_edit_ids: list[str]       # IDs after persist
        error:         Optional[str]

    # ------------------------------------------------------------------
    # Node 1: retrieve
    # Pull typed entities for the tenant/objective from Supabase intel
    # schema using supabase-py.  READ ONLY — no writes here.
    # ------------------------------------------------------------------

    async def retrieve(state: AnalysisState) -> AnalysisState:
        """
        Fetch entities from intel.entity for the given tenant and
        optional entity_id filter.  Falls back to an empty list on error
        so the graph can still produce a narrative from context alone.
        """
        # Lazy import supabase-py
        try:
            from supabase import create_client, Client   # type: ignore
        except ImportError:
            # If supabase isn't available, return empty entities gracefully
            return {**state, "entities": [], "error": "supabase not installed"}

        supabase_url = os.environ.get("SUPABASE_URL", "")
        service_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

        if not supabase_url or not service_key:
            return {**state, "entities": [], "error": "SUPABASE_URL/SERVICE_ROLE_KEY not set"}

        try:
            client: Client = create_client(supabase_url, service_key)

            query = (
                client.schema("intel").table("entity")
                .select("*")
                .eq("tenant_id", state["tenant_id"])
            )

            if state.get("entity_ids"):
                query = query.in_("id", state["entity_ids"])

            resp = query.execute()
            entities = resp.data or []
        except Exception as exc:
            entities = []
            state = {**state, "error": f"retrieve failed: {exc}"}

        return {**state, "entities": entities}

    # ------------------------------------------------------------------
    # Node 2: reason
    # Route to the best available LLM (synthesize tier → critical).
    # Works over STRUCTURED entity data, not raw text.
    # ------------------------------------------------------------------

    async def reason(state: AnalysisState) -> AnalysisState:
        """
        Synthesise an analytical narrative over retrieved entities.
        Uses route_complete with task='synthesize' (→ critical tier).
        """
        entities = state.get("entities", [])
        objective = state.get("objective", "")

        system = (
            "You are a structured intelligence analyst. "
            "You receive typed entity records from an intel graph and produce "
            "a concise, evidence-based narrative for an analyst. "
            "Focus on connections, risks, and gaps. "
            "Do not hallucinate data not present in the entity records. "
            "Output: 3–6 paragraphs of plain prose."
        )

        entity_summary = "\n".join(
            f"- [{e.get('type', 'unknown')}] {e.get('canonical_name', 'unnamed')} "
            f"(id={e.get('id', '?')}, risk={e.get('risk_score', 'n/a')})"
            for e in entities
        ) or "(no entities retrieved)"

        prompt = (
            f"Objective: {objective}\n\n"
            f"Entities ({len(entities)}):\n{entity_summary}\n\n"
            "Provide your intelligence assessment."
        )

        try:
            result = await route_complete(task="synthesize", system=system, prompt=prompt)
            narrative = result["text"]
        except RuntimeError as exc:
            # No provider keys available — surface as error; main.py returns 503
            return {**state, "narrative": "", "error": str(exc)}

        return {**state, "narrative": narrative}

    # ------------------------------------------------------------------
    # Node 3: propose
    # Convert LLM suggestions into ProposedEdit dicts.
    # The LLM narrative drives extraction; NO DB writes here.
    # ------------------------------------------------------------------

    async def propose(state: AnalysisState) -> AnalysisState:
        """
        Build ProposedEdit payloads from the LLM narrative.

        Current strategy: produce one 'create_entity' proposal per entity
        the LLM flagged as noteworthy in the narrative (simple heuristic;
        extend with a structured extraction call if needed).

        GOVERNANCE: propose helpers return dicts only.  Nothing is written
        to intel.entity or intel.link here.
        """
        narrative   = state.get("narrative", "")
        tenant_id   = state.get("tenant_id", "")
        proposed_edits: list[dict] = []

        if not narrative or not tenant_id:
            return {**state, "proposed_edits": proposed_edits}

        # Use a fast LLM call to extract structured entity proposals
        system = (
            "You are a structured data extractor. "
            "Given an intelligence narrative, extract up to 5 NEW entities "
            "that should be added to the knowledge graph. "
            "Return ONLY a JSON array, no prose. Each element: "
            '{"type": "<ObjectType>", "canonical_name": "<name>", '
            '"rationale": "<one sentence>", "properties": {}}'
        )
        prompt = f"Narrative:\n{narrative}\n\nExtract new entities to propose."

        try:
            result = await route_complete(task="extract", system=system, prompt=prompt)
            import json
            raw = result["text"].strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            proposals = json.loads(raw)
        except Exception:
            proposals = []

        for p in proposals[:5]:   # cap at 5 proposals per run
            try:
                edit = propose_create_entity(
                    tenant_id=   tenant_id,
                    entity={
                        "type":           p.get("type", "company"),
                        "canonical_name": p.get("canonical_name", ""),
                        "properties":     p.get("properties", {}),
                    },
                    proposed_by= "worker:graph",
                    rationale=   p.get("rationale", ""),
                )
                proposed_edits.append(edit)
            except Exception:
                continue

        return {**state, "proposed_edits": proposed_edits}

    # ------------------------------------------------------------------
    # Node 4: persist
    # ╔══════════════════════════════════════════════════════════════╗
    # ║  GOVERNANCE BOUNDARY — THE ONLY DB WRITE IN THE GRAPH       ║
    # ║                                                              ║
    # ║  Writes ONLY to intel.proposed_edit with status='pending'.  ║
    # ║  Never writes to intel.entity or intel.link.                 ║
    # ║                                                              ║
    # ║  Flow after this node:                                       ║
    # ║    pending → analyst approves in Kammandor UI               ║
    # ║    approved → application job applies to entity/link        ║
    # ╚══════════════════════════════════════════════════════════════╝
    # ------------------------------------------------------------------

    async def persist(state: AnalysisState) -> AnalysisState:
        """
        Insert ProposedEdit rows into intel.proposed_edit (status='pending').

        This is the ONLY node that writes to the database, and it writes
        ONLY to the proposed_edit queue — never to entity or link tables.
        """
        proposed_edits = state.get("proposed_edits", [])
        if not proposed_edits:
            return {**state, "proposed_edit_ids": []}

        # Lazy import supabase-py
        try:
            from supabase import create_client   # type: ignore
        except ImportError:
            return {**state, "proposed_edit_ids": [], "error": "supabase not installed"}

        supabase_url = os.environ.get("SUPABASE_URL", "")
        service_key  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

        if not supabase_url or not service_key:
            return {**state, "proposed_edit_ids": [], "error": "DB not configured"}

        try:
            client = create_client(supabase_url, service_key)

            # Write ONLY to intel.proposed_edit — never to entity/link
            resp = (
                client.schema("intel").table("proposed_edit")
                .insert(proposed_edits)
                .execute()
            )
            inserted_ids = [row["id"] for row in (resp.data or [])]
        except Exception as exc:
            return {**state, "proposed_edit_ids": [], "error": f"persist failed: {exc}"}

        return {**state, "proposed_edit_ids": inserted_ids}

    # ------------------------------------------------------------------
    # Graph wiring
    # ------------------------------------------------------------------

    builder = StateGraph(AnalysisState)
    builder.add_node("retrieve", retrieve)
    builder.add_node("reason",   reason)
    builder.add_node("propose",  propose)
    builder.add_node("persist",  persist)

    builder.set_entry_point("retrieve")
    builder.add_edge("retrieve", "reason")
    builder.add_edge("reason",   "propose")
    builder.add_edge("propose",  "persist")
    builder.add_edge("persist",  END)

    return builder.compile()


# Module-level compiled graph (built lazily on first call)
_compiled_graph = None


def get_graph():
    """Return the compiled graph, building it on first call."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph()
    return _compiled_graph


async def run_analysis(
    tenant_id:  str,
    objective:  str,
    entity_ids: Optional[list[str]] = None,
) -> dict[str, Any]:
    """
    Run the governed analysis graph.
    Returns {narrative, proposed_edit_ids, error?}.
    """
    graph = get_graph()
    initial_state = {
        "tenant_id":  tenant_id,
        "objective":  objective,
        "entity_ids": entity_ids or [],
    }
    final_state = await graph.ainvoke(initial_state)
    return {
        "narrative":          final_state.get("narrative", ""),
        "proposed_edit_ids":  final_state.get("proposed_edit_ids", []),
        "error":              final_state.get("error"),
    }
