import { DEFAULT_QUERY } from '../default-queries';
import { readLastQuery } from './last_query';
import { getQueryFromHash } from './query_share';

/**
 * THE one place that decides which query the editor opens with.
 * Priority, in order:
 *
 *   1. a `#q=` share link in the URL — an explicit link always wins,
 *   2. the query saved in localStorage from the last session,
 *   3. the built-in default query.
 *
 * Pure core, so the order itself is unit-tested; a malformed share link
 * falls through to the next source rather than producing an empty editor.
 */
export function pickInitialQuery(
  hash: string | null | undefined,
  saved: string | null,
  fallback: string,
): string {
  const fromLink = hash ? getQueryFromHash(hash) : null;
  return fromLink ?? saved ?? fallback;
}

/**
 * Environment-reading wrapper for [`pickInitialQuery`].  Resolved BEFORE the
 * first render (a `useState` initializer), so the share link cannot lose a
 * race against the saved query on the editor's mount path.
 */
export function resolveInitialQuery(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_QUERY;
  }
  return pickInitialQuery(window.location.hash, readLastQuery(), DEFAULT_QUERY);
}
