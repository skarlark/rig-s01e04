export type DigestStatus = 'ok' | 'retry' | 'fail'

/** Counts of accepted log events, not jobs or final job statuses. */
export interface DigestCounts {
  ok: number
  retry: number
  fail: number
}

/** One job's accepted events, ordered by timestamp, then source line for ties. */
export interface DigestRow {
  job: string
  /** Owner on the latest event, including an explicit null. */
  owner: string | null
  /** All accepted events for this job, including retries and failures. */
  runs: number
  /** Retry events; equal to counts.retry. */
  retries: number
  lastStatus: DigestStatus
  /** Latest supplied error, retained after recovery; null if none was supplied. */
  lastError: string | null
  /** Earliest and latest instants, preserving each original timestamp and offset. */
  firstAt: string
  lastAt: string
  /** Allows views to mark any failure, even when the final event succeeds. */
  counts: DigestCounts
}

export interface DigestNight {
  night: string
  /** One row per job, in compareDigestRows order. Empty means nothing ran. */
  rows: DigestRow[]
  /** Nonblank lines rejected for invalid JSON or invalid event fields. */
  badLines: number
  /** Totals over all accepted events; the sum of each row's counts. */
  counts: DigestCounts
}

/** Missing files and invalid night identifiers resolve to null. */
export type ReadNightResult = DigestNight | null

/**
 * Signature for readNight, to be implemented/exported by src/digest/reader.ts.
 *
 * Accept only a calendar date in YYYY-MM-DD form as night. Invalid identifiers
 * must not access paths outside runsDir. Missing files resolve to null; other
 * filesystem errors reject. An existing empty file returns a DigestNight with
 * empty rows, zero badLines and zero counts. Blank lines are ignored.
 *
 * Accepted events have an offset-bearing timestamp, job string, DigestStatus,
 * owner string or null, and an optional string error. Invalid events count as
 * bad lines and contribute nothing else. Compare timestamps by instant (never
 * lexically); equal instants use source line order. Preserve timestamp text for
 * display. lastStatus and owner come from the latest event; lastError comes
 * from the latest event that supplies error, even if followed by success.
 * All consumers use these same rows and counts rather than re-aggregating logs.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<ReadNightResult>

/** Locale-independent ascending job order shared by HTML and JSON consumers. */
export function compareDigestRows(a: DigestRow, b: DigestRow): number {
  return a.job < b.job ? -1 : a.job > b.job ? 1 : 0
}
