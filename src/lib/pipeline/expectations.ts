/**
 * KINTEL v2.1 — Data expectations engine (PRD §8.5)
 *
 * GOVERNANCE: hard-level failures are HARD-FAIL gates. If ANY record fails
 * ANY hard expectation, the report marks the whole batch as not accepted —
 * there is no partial acceptance and no silent propagation. Warn-level
 * failures are recorded loudly but never block. A throwing check() counts
 * as a failure for that record; the gate itself never crashes.
 */

import type {
  Expectation,
  ExpectationFailure,
  ExpectationLevel,
  ExpectationReport,
} from './types';

/** Max failing-record indexes retained per expectation (failedCount stays exact). */
const SAMPLE_INDEX_CAP = 5;

// ---------------------------------------------------------------------------
// Safe dot-path access
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path (e.g. 'attributes.entity') against an unknown record.
 * Returns undefined if any hop is missing or not a plain object.
 */
function getPath(record: unknown, path: string): unknown {
  let current: unknown = record;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Reusable expectation builders
// ---------------------------------------------------------------------------

/**
 * Field (dot-path supported) must be present and non-empty:
 * fails on non-object records, missing keys, null/undefined, and ''.
 */
export function required(path: string, level: ExpectationLevel): Expectation {
  return {
    name: `required:${path}`,
    level,
    description: `Field '${path}' must be present and non-empty`,
    check(record: unknown): boolean {
      const value = getPath(record, path);
      if (value === null || value === undefined) return false;
      if (typeof value === 'string' && value === '') return false;
      return true;
    },
  };
}

/** Field must be a string parseable as an ISO 8601 timestamp. */
export function isoTimestamp(path: string, level: ExpectationLevel): Expectation {
  return {
    name: `isoTimestamp:${path}`,
    level,
    description: `Field '${path}' must be an ISO 8601 timestamp string`,
    check(record: unknown): boolean {
      const value = getPath(record, path);
      if (typeof value !== 'string') return false;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return false;
      return !Number.isNaN(Date.parse(value));
    },
  };
}

/** Field must be a finite number within [min, max] inclusive. */
export function numericRange(
  path: string,
  min: number,
  max: number,
  level: ExpectationLevel,
): Expectation {
  return {
    name: `numericRange:${path}`,
    level,
    description: `Field '${path}' must be a number in [${min}, ${max}]`,
    check(record: unknown): boolean {
      const value = getPath(record, path);
      if (typeof value !== 'number' || Number.isNaN(value)) return false;
      return value >= min && value <= max;
    },
  };
}

// ---------------------------------------------------------------------------
// Batch gate
// ---------------------------------------------------------------------------

/**
 * Evaluate every expectation against every record and produce a loud,
 * structured report. Never throws: a throwing check() is a failure for that
 * record. batchAccepted is false iff any hard expectation failed at all.
 */
export function runExpectations(
  records: unknown[],
  expectations: Expectation[],
): ExpectationReport {
  const hardFailures: ExpectationFailure[] = [];
  const warnings: ExpectationFailure[] = [];

  for (const expectation of expectations) {
    let failedCount = 0;
    const sampleIndexes: number[] = [];

    for (let index = 0; index < records.length; index++) {
      let passed = false;
      try {
        passed = expectation.check(records[index]) === true;
      } catch {
        passed = false; // a throwing check counts as a failure, never a crash
      }
      if (!passed) {
        failedCount += 1;
        if (sampleIndexes.length < SAMPLE_INDEX_CAP) sampleIndexes.push(index);
      }
    }

    if (failedCount > 0) {
      const failure: ExpectationFailure = {
        expectation: expectation.name,
        level: expectation.level,
        failedCount,
        sampleIndexes,
      };
      if (expectation.level === 'hard') hardFailures.push(failure);
      else warnings.push(failure);
    }
  }

  return {
    batchAccepted: hardFailures.length === 0,
    total: records.length,
    hardFailures,
    warnings,
  };
}
