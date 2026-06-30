"""
KINTEL Workers — MoE unit tests
Key-free: no network calls, no API keys required.

Tests:
  1. tier_for_task  → correct tier for 'extract', 'analyze', 'dossier'
  2. providers_for_tier → correct provider lists
  3. propose helpers return ProposedEdit dicts (not DB objects)
  4. Governance: propose helpers produce dicts; persist is the ONLY writer
     (verified by asserting no direct entity/link insert in propose helpers)
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ---------------------------------------------------------------------------
# Tier / provider tests (pure logic — no I/O)
# ---------------------------------------------------------------------------

def test_tier_for_task_extract():
    from workers.app.moe import tier_for_task
    assert tier_for_task("extract") == "fast"

def test_tier_for_task_analyze():
    from workers.app.moe import tier_for_task
    assert tier_for_task("analyze") == "balanced"

def test_tier_for_task_dossier():
    from workers.app.moe import tier_for_task
    assert tier_for_task("dossier") == "critical"

def test_tier_for_task_synthesize():
    from workers.app.moe import tier_for_task
    assert tier_for_task("synthesize") == "critical"

def test_tier_for_task_unknown_falls_back_to_balanced():
    from workers.app.moe import tier_for_task
    assert tier_for_task("unknown_task_xyz") == "balanced"

def test_providers_for_tier_fast():
    from workers.app.moe import providers_for_tier
    assert providers_for_tier("fast") == ["openai", "google"]

def test_providers_for_tier_balanced():
    from workers.app.moe import providers_for_tier
    assert providers_for_tier("balanced") == ["zhipu", "google"]

def test_providers_for_tier_critical():
    from workers.app.moe import providers_for_tier
    result = providers_for_tier("critical")
    assert result[0] == "anthropic", f"Expected anthropic first, got {result}"

def test_providers_for_tier_critical_full_list():
    from workers.app.moe import providers_for_tier
    assert providers_for_tier("critical") == ["anthropic", "zhipu"]


# ---------------------------------------------------------------------------
# Ontology / propose helper tests
# ---------------------------------------------------------------------------

def test_propose_create_entity_returns_dict():
    from workers.app.ontology import propose_create_entity
    result = propose_create_entity(
        tenant_id=   "t1",
        entity={
            "type":           "company",
            "canonical_name": "Acme Corp",
            "properties":     {},
        },
        proposed_by= "test",
        rationale=   "test rationale",
    )
    assert isinstance(result, dict)
    assert result["kind"] == "create_entity"
    assert result["status"] == "pending"
    assert result["tenant_id"] == "t1"
    assert "id" in result
    assert "payload" in result


def test_propose_create_link_returns_dict():
    from workers.app.ontology import propose_create_link
    result = propose_create_link(
        tenant_id=   "t1",
        link={
            "source_entity_id": "e1",
            "target_entity_id": "e2",
            "type":             "isDirectorOf",
            "properties":       {},
        },
        proposed_by= "test",
        rationale=   "test rationale",
    )
    assert isinstance(result, dict)
    assert result["kind"] == "create_link"
    assert result["status"] == "pending"


def test_propose_update_returns_dict():
    from workers.app.ontology import propose_update
    result = propose_update(
        tenant_id=   "t1",
        kind=        "update_entity",
        target_id=   "e1",
        patch=       {"risk_score": 0.9},
        proposed_by= "test",
        rationale=   "elevated risk",
    )
    assert isinstance(result, dict)
    assert result["kind"] == "update_entity"
    assert result["payload"]["id"] == "e1"
    assert result["payload"]["patch"]["risk_score"] == 0.9


def test_propose_helpers_never_write_to_db():
    """
    Governance test: proposal helpers must NOT call any DB client.
    They return plain dicts.  The graph's persist node is the only writer.
    """
    import workers.app.ontology as ontology_module
    import inspect

    # Verify propose helpers don't import supabase at module level
    source = inspect.getsource(ontology_module)
    assert "create_client" not in source, (
        "ontology.py must not call create_client — no DB writes in propose helpers"
    )
    assert "supabase" not in source, (
        "ontology.py must not import supabase — propose helpers are DB-free"
    )


# ---------------------------------------------------------------------------
# Governance: persist is the ONLY writer (mock-based)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_persist_node_is_only_writer():
    """
    Verify that graph.py's persist node writes ONLY to intel.proposed_edit.
    We mock the supabase client and assert the table name.
    """
    import sys
    import importlib

    # Fake supabase module so we can inspect calls
    fake_table_calls = []

    class FakeTable:
        def __init__(self, name):
            self._name = name
            fake_table_calls.append(name)
        def insert(self, data):
            return self
        def execute(self):
            result = MagicMock()
            result.data = [{"id": "test-id-1"}]
            return result
        def select(self, *a):
            return self
        def eq(self, *a):
            return self
        def in_(self, *a):
            return self

    class FakeClient:
        def table(self, name):
            return FakeTable(name)

    fake_supabase = MagicMock()
    fake_supabase.create_client = lambda url, key: FakeClient()

    # Patch supabase in the graph module
    with patch.dict(sys.modules, {"supabase": fake_supabase}):
        # Import graph fresh for this test
        if "workers.app.graph" in sys.modules:
            del sys.modules["workers.app.graph"]
        # Also need langgraph mocked
        fake_langgraph = MagicMock()
        # Create a StateGraph that just stores the nodes and edges
        class FakeStateGraph:
            def __init__(self, state_schema):
                self._nodes = {}
                self._edges = []
            def add_node(self, name, fn):
                self._nodes[name] = fn
            def set_entry_point(self, name):
                pass
            def add_edge(self, a, b):
                self._edges.append((a, b))
            def compile(self):
                return self

            async def ainvoke(self, state):
                # Run the nodes in order
                import os
                os.environ.setdefault("SUPABASE_URL", "http://fake")
                os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "fake-key")
                s = state.copy()
                s.setdefault("entities", [])
                s.setdefault("narrative", "Test narrative for governance test.")
                s.setdefault("proposed_edits", [
                    {
                        "id": "pe-1",
                        "tenant_id": state.get("tenant_id", "t1"),
                        "kind": "create_entity",
                        "payload": {"type": "company", "canonical_name": "TestCo", "properties": {}},
                        "proposed_by": "worker:graph",
                        "rationale": "test",
                        "status": "pending",
                        "created_at": "2024-01-01T00:00:00+00:00",
                    }
                ])
                # Run persist node directly
                persist_fn = self._nodes.get("persist")
                if persist_fn:
                    s = await persist_fn(s)
                return s

        fake_langgraph_end = "END"
        fake_langgraph_module = MagicMock()
        fake_langgraph_module.graph.StateGraph = FakeStateGraph
        fake_langgraph_module.graph.END = fake_langgraph_end

        with patch.dict(sys.modules, {
            "langgraph": fake_langgraph_module,
            "langgraph.graph": fake_langgraph_module.graph,
        }):
            if "workers.app.graph" in sys.modules:
                del sys.modules["workers.app.graph"]
            from workers.app.graph import run_analysis

            import os
            os.environ["SUPABASE_URL"] = "http://fake"
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "fake-key"

            result = await run_analysis(
                tenant_id=  "t1",
                objective=  "Test objective",
                entity_ids= [],
            )

    # The ONLY table written to must be intel.proposed_edit (or none if mocking bypassed)
    for table_name in fake_table_calls:
        assert table_name == "intel.proposed_edit", (
            f"Governance violation: persist node wrote to '{table_name}' "
            f"instead of 'intel.proposed_edit'"
        )

    # Result shape is correct
    assert "narrative" in result
    assert "proposed_edit_ids" in result
