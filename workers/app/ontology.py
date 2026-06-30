"""
KINTEL Workers — Ontology Pydantic Models
Mirrors src/lib/ontology/types.ts and src/lib/ontology/propose.ts

Governance boundary:
  These helpers build ProposedEdit payloads ONLY.
  No DB writes occur here.  A human must approve before application.

Flow:
  1. LLM / graph agent calls propose_* to construct a ProposedEdit dict.
  2. The graph's persist node inserts into intel.proposed_edit (status='pending').
  3. Human reviewer approves (status→'approved') or rejects (status→'rejected').
  4. An application-layer job reads approved rows, applies them to
     intel.entity / intel.link, then sets status→'applied'.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

ObjectType = Literal[
    "company", "person", "fund", "deal", "vessel", "port",
    "wallet", "sanction", "filing", "event", "asset",
    "jurisdiction", "news_source", "instrument",
]

LinkType = Literal[
    "isDirectorOf", "beneficialOwnerOf", "shareholderOf",
    "subsidiaryOf", "isNamedInDeal", "isSubjectOf",
    "registeredIn", "filedWith", "portCallAt",
    "linkedWallet", "mentionedInEvent", "connectedJurisdiction",
    "ownsAsset", "pricedBy",
]

EditKind = Literal["create_entity", "update_entity", "create_link", "update_link"]
EditStatus = Literal["pending", "approved", "rejected", "applied"]

# ---------------------------------------------------------------------------
# Core models (mirror SQL columns in intel schema)
# ---------------------------------------------------------------------------


class Entity(BaseModel):
    """Mirrors intel.entity"""
    id:                 str
    tenant_id:          str
    type:               ObjectType
    canonical_name:     Optional[str]       = None
    properties:         dict[str, Any]      = Field(default_factory=dict)
    risk_score:         Optional[float]     = None
    risk_category:      Optional[str]       = None
    last_screened_at:   Optional[str]       = None   # ISO 8601
    lei:                Optional[str]       = None
    company_number:     Optional[str]       = None
    imo:                Optional[str]       = None
    mmsi:               Optional[str]       = None
    isin:               Optional[str]       = None
    wallet_address:     Optional[str]       = None
    jurisdiction_code:  Optional[str]       = None
    created_at:         str                 = Field(default_factory=lambda: _now())
    updated_at:         str                 = Field(default_factory=lambda: _now())


class Link(BaseModel):
    """Mirrors intel.link"""
    id:               str
    tenant_id:        str
    source_entity_id: str
    target_entity_id: str
    type:             LinkType
    properties:       dict[str, Any]  = Field(default_factory=dict)
    valid_from:       Optional[str]   = None   # ISO 8601
    valid_to:         Optional[str]   = None   # ISO 8601
    created_at:       str             = Field(default_factory=lambda: _now())


class ProposedEdit(BaseModel):
    """Mirrors intel.proposed_edit — the ONLY model the graph writes."""
    id:           str
    tenant_id:    str
    kind:         EditKind
    payload:      dict[str, Any]
    proposed_by:  str
    rationale:    Optional[str]  = None
    status:       EditStatus     = "pending"
    reviewed_by:  Optional[str]  = None
    reviewed_at:  Optional[str]  = None   # ISO 8601
    created_at:   str            = Field(default_factory=lambda: _now())

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

# ---------------------------------------------------------------------------
# Proposal helpers — NEVER write to entity/link directly
# ---------------------------------------------------------------------------


def propose_create_entity(
    tenant_id:   str,
    entity:      dict[str, Any],   # Omit id / created_at / updated_at
    proposed_by: str,
    rationale:   str,
) -> dict[str, Any]:
    """
    Build a ProposedEdit dict for creating a new entity.
    Does NOT write to the database.
    """
    edit = ProposedEdit(
        id=          _new_id(),
        tenant_id=   tenant_id,
        kind=        "create_entity",
        payload=     entity,
        proposed_by= proposed_by,
        rationale=   rationale,
        status=      "pending",
        created_at=  _now(),
    )
    return edit.model_dump()


def propose_create_link(
    tenant_id:   str,
    link:        dict[str, Any],   # Omit id / created_at
    proposed_by: str,
    rationale:   str,
) -> dict[str, Any]:
    """
    Build a ProposedEdit dict for creating a new link.
    Does NOT write to the database.
    """
    edit = ProposedEdit(
        id=          _new_id(),
        tenant_id=   tenant_id,
        kind=        "create_link",
        payload=     link,
        proposed_by= proposed_by,
        rationale=   rationale,
        status=      "pending",
        created_at=  _now(),
    )
    return edit.model_dump()


def propose_update(
    tenant_id:   str,
    kind:        Literal["update_entity", "update_link"],
    target_id:   str,
    patch:       dict[str, Any],
    proposed_by: str,
    rationale:   str,
) -> dict[str, Any]:
    """
    Build a ProposedEdit dict for a partial update to an entity or link.
    Does NOT write to the database.
    """
    edit = ProposedEdit(
        id=          _new_id(),
        tenant_id=   tenant_id,
        kind=        kind,
        payload=     {"id": target_id, "patch": patch},
        proposed_by= proposed_by,
        rationale=   rationale,
        status=      "pending",
        created_at=  _now(),
    )
    return edit.model_dump()
