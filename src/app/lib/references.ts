/**
 * Label for the fetch-more references section. Before the first fetch no
 * count is known; after it, the server's count is exact unless capped —
 * capped counts render as "N+" (at least N), never as a total.
 */
export function formatMoreReferencesLabel(count: number | null, countCapped: boolean): string {
  if (count === null) {
    return 'More references';
  }
  return `More references (${count}${countCapped ? '+' : ''})`;
}

/**
 * Label for the fetch-more instances section — the total is EXACT (a
 * per-symbol instance count is bounded by the symbol's own size).
 */
export function formatMoreInstancesLabel(shown: number, total: number): string {
  return `More instances (${shown} of ${total} shown)`;
}

import type { SymbolInstancePageRowJson } from '../askld';
import type { GraphObject, SymbolInstance } from '../graph';

/**
 * Convert a fetched instances-page row into the `SymbolInstance` shape the
 * hover's typed sections render. `symbol` is the truncated symbol the page
 * was fetched for; `symbol_type` is not carried by the row and not read by
 * any hover path.
 */
export function instanceRowToSymbolInstance(
  row: SymbolInstancePageRowJson,
  symbol: string,
): SymbolInstance {
  return {
    id: row.id,
    symbol,
    object_id: row.object_id,
    symbol_type: '',
    instance_type: row.instance_type,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
  };
}

/**
 * The hover resolves file paths through `graph.objects`, but fetched rows
 * can reference files absent from the graph. Overlay their `{path,
 * project_id}` onto a copy of the base map so paths and sorting work for
 * fetched rows too.
 */
export function overlayObjects(
  base: Map<string, GraphObject>,
  rows: SymbolInstancePageRowJson[],
): Map<string, GraphObject> {
  if (rows.length === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const row of rows) {
    if (!merged.has(row.object_id)) {
      merged.set(row.object_id, { path: row.path, project_id: row.project_id });
    }
  }
  return merged;
}
