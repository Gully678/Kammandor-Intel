/**
 * KINTEL v2.3 — Intel SDK public entry point (PRD §10.1)
 *
 *   import { createIntelClient } from '@/lib/sdk/intel';
 *
 * Distinct from the legacy Osiris SDK files in src/lib/sdk/ (types.ts,
 * PolybolosClient.ts, LatticeAdapter.ts), which are untouched.
 */

export { createIntelClient, IntelApiError } from './client';
export type { IntelClient, IntelClientOptions } from './client';
export type {
  AlertRecord,
  ApiErrorBody,
  GraphEdge,
  GraphQuery,
  GraphQueryResponse,
  GraphQueryStart,
  GraphTraverseStep,
  LicenceClass,
  LinkType,
  ListAlertsParams,
  ListAlertsResponse,
  ListObjectsParams,
  ListObjectsResponse,
  ObjectDetailResponse,
  ObjectIdentifiers,
  ObjectLink,
  ObjectSummary,
  ObjectType,
  ProvenanceRecord,
  TraverseDirection,
  VersionRecord,
} from './types';
