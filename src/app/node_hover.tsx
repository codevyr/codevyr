import React, { useCallback, useEffect, useState } from 'react';
import { LuArrowUpRight, LuChevronDown, LuChevronRight, LuCopy, LuFocus, LuFolderOpen } from 'react-icons/lu';
import { CodeFocus } from './code_viewer';
import { Edge, SymbolInstance, QueryStatement, Node, Graph, isDirectoryInstance, isSelfReference } from './graph';
import { copyToClipboard } from './lib/clipboard';
import { formatOffsetLocation, getLineColumnFromOffset, parseOffset } from './lib/offsets';
import {
  fetchEdgeOccurrences,
  fetchSymbolInstances,
  fetchSymbolReferences,
  type EdgeOccurrenceRowJson,
  type EdgeOccurrencesResponse,
  type SymbolInstancePageRowJson,
  type SymbolInstancesResponse,
  type SymbolReferenceRow,
  type SymbolReferencesResponse,
} from './askld';
import {
  formatMoreInstancesLabel,
  formatMoreReferencesLabel,
  instanceRowToSymbolInstance,
  overlayObjects,
} from './lib/references';

type SymbolInstanceSortInfo = {
  path: string;
  line: number;
  column: number;
  offset: number;
};

function resolveSymbolInstanceSortInfo(
  instance: SymbolInstance,
  graph: Graph,
  fileContents: Map<string, string>,
): SymbolInstanceSortInfo {
  const path = graph.objects.get(instance.object_id)?.path ?? instance.object_id;
  const content = fileContents.get(instance.object_id);
  const location = content ? getLineColumnFromOffset(content, instance.start_offset) : null;
  const line = location?.lineNumber ?? Number.MAX_SAFE_INTEGER;
  const column = location?.column ?? Number.MAX_SAFE_INTEGER;
  const offset = parseOffset(instance.start_offset) ?? Number.MAX_SAFE_INTEGER;

  return { path, line, column, offset };
}

function compareSymbolInstances(
  left: SymbolInstance,
  right: SymbolInstance,
  graph: Graph,
  fileContents: Map<string, string>,
) {
  const leftInfo = resolveSymbolInstanceSortInfo(left, graph, fileContents);
  const rightInfo = resolveSymbolInstanceSortInfo(right, graph, fileContents);

  const pathCompare = leftInfo.path.localeCompare(rightInfo.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }
  if (leftInfo.line !== rightInfo.line) {
    return leftInfo.line - rightInfo.line;
  }
  if (leftInfo.column !== rightInfo.column) {
    return leftInfo.column - rightInfo.column;
  }
  return leftInfo.offset - rightInfo.offset;
}

interface SymbolInstanceHoverProps {
  row: SymbolInstancePageRowJson;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
}

function SymbolInstanceHover({ row, setCodeFocus, fileContents, onAction }: SymbolInstanceHoverProps) {
  // The row carries its own path — no objects map needed.
  const filePath = row.path;
  const location = formatOffsetLocation(fileContents.get(row.object_id), row.start_offset);
  const instance = row;

  function openInEditor() {
    setCodeFocus({
      object_id: row.object_id,
      start_offset: row.start_offset,
      end_offset: row.end_offset,
    });
  }

  function copyPath() {
    void copyToClipboard(filePath);
    onAction?.();
  }

  return (
    <tr
      className="declaration-hover"
      data-testid={`instance-row-${instance.id}`}
      onClick={openInEditor}
    >
      <td>{filePath}</td>
      <td>{location}</td>
      <td className="node-hover-actions-cell">
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            openInEditor();
          }}
          title="Open in editor"
        >
          <LuArrowUpRight />
        </button>
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            copyPath();
          }}
          title="Copy path"
        >
          <LuCopy />
        </button>
      </td>
    </tr>
  );
}

function SectionHeader({ name, expanded, onToggle }: { name: string; expanded: boolean; onToggle: () => void }) {
  return (
    <thead>
      <tr className="section-header-toggle" onClick={onToggle}>
        <th colSpan={3}>
          <span className="section-header-chevron">
            {expanded ? <LuChevronDown /> : <LuChevronRight />}
          </span>
          {name}
        </th>
      </tr>
    </thead>
  );
}

interface NodeHoverSectionProps {
  sectionName: string;
  /** Fetched instance rows, already in the server's display order. */
  rows: SymbolInstancePageRowJson[];
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
}

function capitalizeInstanceType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function NodeHoverSection({
  sectionName,
  rows,
  setCodeFocus,
  fileContents,
  onAction,
}: NodeHoverSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (rows.length === 0) {
    return null;
  }

  // No client-side sort: the endpoint pages in display order already.
  return (
    <>
      <SectionHeader name={sectionName} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      {expanded && (
        <tbody>
          {rows.map((row) => (
            <SymbolInstanceHover
              key={row.id}
              row={row}
              setCodeFocus={setCodeFocus}
              fileContents={fileContents}
              onAction={onAction}
            />
          ))}
        </tbody>
      )}
    </>
  );
}

const QUERY_STATEMENT_MAX_LENGTH = 30;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\u2026';
}

interface QueryStatementSectionProps {
  statements: QueryStatement[];
  revealQueryRange?: (start: number, end: number) => void;
  onAction?: () => void;
}

function QueryStatementSection({ statements, revealQueryRange, onAction }: QueryStatementSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (statements.length === 0) return null;
  return (
    <>
      <SectionHeader name="Query statements" expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      {expanded && (
        <tbody>
          {statements.map((stmt) => (
            <tr
              key={`${stmt.start}-${stmt.end}`}
              className="declaration-hover"
              onClick={() => { revealQueryRange?.(stmt.start, stmt.end); onAction?.(); }}
            >
              <td colSpan={2} title={stmt.text}>
                <code>{truncateText(stmt.text, QUERY_STATEMENT_MAX_LENGTH)}</code>
              </td>
              <td className="node-hover-actions-cell">
                <button
                  type="button"
                  className="node-hover-icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    revealQueryRange?.(stmt.start, stmt.end);
                    onAction?.();
                  }}
                  title="Open in editor"
                >
                  <LuArrowUpRight />
                </button>
                <button
                  type="button"
                  className="node-hover-icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    void copyToClipboard(stmt.text);
                    onAction?.();
                  }}
                  title="Copy"
                >
                  <LuCopy />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      )}
    </>
  );
}

const INSTANCE_TYPE_ORDER: Record<string, number> = {
  sentinel: 1,
  header: 2,
  source: 3,
  build: 4,
  file: 5,
  containment: 6,
  documentation: 7,
  declaration: 8,
  definition: 9,
  expansion: 10,
};

export interface NodeHoverProps {
  node: Node;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  isGroupNode?: boolean;
  revealDirectory?: (objectId: string, path?: string | null, projectId?: string | null) => void;
  hiddenRefEdges?: Array<Edge>;
  /** Raw symbol ids whose out-edges the server truncated (fetch-more). */
  truncatedRefSymbols?: Array<string>;
  /** Learn a file's path/project as detail rows arrive (no objects map). */
  registerObject?: (objectId: string, path: string, projectId: string | null) => void;
  revealQueryRange?: (start: number, end: number) => void;
  onAction?: () => void;
}

type PagedResult<R> = {
  rows: R[];
  next: string | null;
  total: number | null;
};

type PagedState<R> = {
  /** The inputs this result answers; a result for other inputs is stale. */
  key: string;
  page: PagedResult<R>;
  error: string | null;
};

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A list that arrives in pages: the first page is requested when `key`
 * changes, further pages through `loadMore`.
 *
 * "Loading" is DERIVED -- the stored result does not answer the current key
 * -- rather than tracked by a setState inside the effect. The lint rule
 * `react-hooks/set-state-in-effect` treats any setState reachable from an
 * effect body as a cascading render, and it follows local functions, so a
 * `loadPage` callback invoked from the effect is flagged no matter how many
 * awaits precede its setState calls. Only the promise callbacks touch state,
 * which is the shape markdown_report.tsx already uses for the same reason.
 *
 * `fetchPage` must be referentially stable (a `useCallback`); it changes
 * together with `key`, and either change discards the stored result.
 */
function usePagedList<R>(key: string, fetchPage: (after: string | null) => Promise<PagedResult<R>>) {
  const [state, setState] = useState<PagedState<R> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setState({ key, page, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || isAbort(err)) return; // superseded by a newer fetch -- not an error state
        setState({ key, page: { rows: [], next: null, total: null }, error: errorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [key, fetchPage]);

  const current = state !== null && state.key === key ? state : null;
  const next = current?.page.next ?? null;

  const loadMore = useCallback(() => {
    if (next === null) return;
    setLoadingMore(true);
    fetchPage(next)
      .then((page) => {
        setState((prev) =>
          prev !== null && prev.key === key
            ? { key, page: { rows: [...prev.page.rows, ...page.rows], next: page.next, total: page.total }, error: null }
            : prev,
        );
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        setState((prev) => (prev !== null && prev.key === key ? { ...prev, error: errorText(err) } : prev));
      })
      .finally(() => setLoadingMore(false));
  }, [key, fetchPage, next]);

  return {
    rows: current?.page.rows ?? [],
    next,
    total: current?.page.total ?? null,
    error: current?.error ?? null,
    /** The first page for the current key has arrived (or failed). */
    loaded: current !== null,
    loading: current === null || loadingMore,
    loadMore,
  };
}

export function NodeHover({
  node,
  setCodeFocus,
  focusNode,
  graph,
  fileContents,
  ensureFileContent,
  isGroupNode,
  revealDirectory,
  hiddenRefEdges,
  truncatedRefSymbols,
  registerObject,
  revealQueryRange,
  onAction,
}: NodeHoverProps) {
  // Instances are NOT in the skeleton — they load here, on open. There is
  // no inlined list to reconcile against, which is what used to make a
  // directory node's list render empty: every shipped instance was filtered
  // out as a "directory instance" and the fetched pages were deduped away.
  // Now the hover simply renders what the endpoint returns.
  const symbolIds = node.symbol_ids;
  const parentSymbol = node.parent_symbol;
  // One symbol per node normally; a merged node pages its first symbol and
  // offers the rest through "Load more".
  const fetchPage = useCallback(
    async (after: string | null): Promise<PagedResult<SymbolInstancePageRowJson>> => {
      const response = await fetchSymbolInstances(symbolIds[0], after, undefined, parentSymbol);
      if (!response.ok) {
        throw new Error(`instances request failed (${response.status})`);
      }
      const data: SymbolInstancesResponse = await response.json();
      for (const row of data.rows) {
        ensureFileContent(row.object_id);
        registerObject?.(row.object_id, row.path, row.project_id);
      }
      return { rows: data.rows, next: typeof data.next === 'string' ? data.next : null, total: data.total };
    },
    [symbolIds, parentSymbol, ensureFileContent, registerObject],
  );
  const { rows, next, total, error, loading, loadMore } = usePagedList(
    `${symbolIds[0]}\u0000${parentSymbol ?? ''}`,
    fetchPage,
  );

  // Group the loaded instances by type, exactly as before — but from the
  // fetched rows, and WITHOUT the group-node filter that hid them.
  const instancesByType = new Map<string, SymbolInstancePageRowJson[]>();
  for (const row of rows) {
    if (row.instance_type === 'unspecified') continue;
    const bucket = instancesByType.get(row.instance_type);
    if (bucket) {
      bucket.push(row);
    } else {
      instancesByType.set(row.instance_type, [row]);
    }
  }

  // A directory's own object is its self-reference (the empty 1..0 range).
  const dirRow = node.is_directory
    ? rows.find((r) => r.start_offset === 1 && r.end_offset === 0) ?? rows[0]
    : undefined;
  const dirPath = dirRow?.path;
  const dirObjectId = dirRow?.object_id;
  const dirProjectId = dirRow?.project_id;

  return (
    <div className="node-hover">
      <div className="node-hover-header">
        <div className="node-hover-title" title={node.label}>
          {node.label}
        </div>
        {node.is_directory && revealDirectory && dirObjectId && (
          <button
            type="button"
            className="node-hover-icon"
            onClick={() => revealDirectory(dirObjectId, dirPath, dirProjectId)}
            title="Reveal in tree"
          >
            <LuFolderOpen />
          </button>
        )}
        <button type="button" className="node-hover-icon" onClick={() => focusNode(node.id)} title="Focus node">
          <LuFocus />
        </button>
        <button type="button" className="node-hover-icon" onClick={() => { void copyToClipboard(node.label); onAction?.(); }} title="Copy symbol name">
          <LuCopy />
        </button>
      </div>
      {node.is_directory && dirPath && (
        <div className="node-hover-dir-path">{dirPath}</div>
      )}
      <table>
        {node.query_statements && node.query_statements.length > 0 && (
          <QueryStatementSection
            statements={node.query_statements}
            revealQueryRange={revealQueryRange}
            onAction={onAction}
          />
        )}
        {Array.from(instancesByType.entries())
          .sort(([a], [b]) => (INSTANCE_TYPE_ORDER[a] ?? 99) - (INSTANCE_TYPE_ORDER[b] ?? 99))
          .map(([typeName, typeRows]) => (
          <NodeHoverSection
            key={typeName}
            sectionName={capitalizeInstanceType(typeName)}
            rows={typeRows}
            setCodeFocus={setCodeFocus}
            fileContents={fileContents}
            onAction={onAction}
          />
        ))}
        <tbody data-testid="load-instances-row">
          {error && (
            <tr>
              <td colSpan={3} data-testid="instances-error">
                {error}
              </td>
            </tr>
          )}
          <tr>
            <td colSpan={3}>
              <span>
                {loading && rows.length === 0
                  ? 'Loading instances…'
                  : formatMoreInstancesLabel(rows.length, total ?? rows.length)}
              </span>
              {next && (
                <button
                  type="button"
                  className="node-hover-text-btn"
                  data-testid="load-instances-more"
                  disabled={loading}
                  style={{ marginLeft: '0.5rem' }}
                  onClick={(event) => {
                    event.stopPropagation();
                    loadMore();
                  }}
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {hiddenRefEdges && hiddenRefEdges.length > 0 && (
        <HiddenReferencesSection
          edges={hiddenRefEdges}
          graph={graph}
          setCodeFocus={setCodeFocus}
          fileContents={fileContents}
          ensureFileContent={ensureFileContent}
          onAction={onAction}
        />
      )}
      {(truncatedRefSymbols ?? []).map((symbol) => (
        <MoreReferencesSection
          key={symbol}
          symbol={symbol}
          fileContents={fileContents}
          ensureFileContent={ensureFileContent}
          setCodeFocus={setCodeFocus}
          onAction={onAction}
        />
      ))}
    </div>
  );
}

/**
 * Fetch-more affordance for a symbol whose implicit out-edges the server
 * capped (`edges_truncated`).  Pages the A2 references endpoint with its
 * keyset cursor; rows land here in the hover only — the graph itself is
 * never mutated, so no re-layout and no node-identity churn.
 */
function MoreReferencesSection({
  symbol,
  fileContents,
  ensureFileContent,
  setCodeFocus,
  onAction,
}: {
  symbol: string;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  setCodeFocus: (type: CodeFocus) => void;
  onAction?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [rows, setRows] = useState<Array<SymbolReferenceRow>>([]);
  const [next, setNext] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [countCapped, setCountCapped] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPage(after: string | null) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchSymbolReferences(symbol, after);
      if (!response.ok) {
        throw new Error(`references request failed (${response.status})`);
      }
      const data: SymbolReferencesResponse = await response.json();
      setRows((prev) => (after ? [...prev, ...data.rows] : data.rows));
      setNext(data.next);
      setCount(data.count);
      setCountCapped(data.count_capped);
      setLoaded(true);
      // Same prefetch discipline as the instance rows: line/column need the
      // file contents.
      for (const row of data.rows) {
        ensureFileContent(row.object_id);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // superseded by a newer fetch — not an error state
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <table data-testid={`more-references-${symbol}`}>
      <SectionHeader
        name={formatMoreReferencesLabel(count, countCapped)}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />
      {expanded && (
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.from_instance_id}-${row.to_symbol}-${row.start_offset}`}
              className="declaration-hover"
              data-testid={`reference-row-${row.to_symbol}-${row.start_offset}`}
              onClick={() => {
                setCodeFocus({
                  object_id: row.object_id,
                  start_offset: row.start_offset,
                  end_offset: row.end_offset,
                });
              }}
            >
              <td title={row.path}>{row.to_symbol_name}</td>
              <td>{formatOffsetLocation(fileContents.get(row.object_id), row.start_offset)}</td>
              <td className="node-hover-actions-cell">
                <button
                  type="button"
                  className="node-hover-icon"
                  onClick={(event) => {
                    event.stopPropagation();
                    setCodeFocus({
                      object_id: row.object_id,
                      start_offset: row.start_offset,
                      end_offset: row.end_offset,
                    });
                    onAction?.();
                  }}
                  title="Open call site in editor"
                >
                  <LuArrowUpRight />
                </button>
              </td>
            </tr>
          ))}
          {error && (
            <tr className="declaration-hover">
              <td colSpan={3} data-testid={`references-error-${symbol}`}>
                {error}
              </td>
            </tr>
          )}
          {(!loaded || next) && (
            <tr className="declaration-hover">
              <td colSpan={3}>
                <button
                  type="button"
                  className="node-hover-text-btn"
                  data-testid={`load-references-${symbol}`}
                  disabled={loading}
                  onClick={(event) => {
                    event.stopPropagation();
                    void loadPage(loaded ? next : null);
                  }}
                >
                  {loading ? 'Loading…' : loaded ? 'Load more' : 'Load references'}
                </button>
              </td>
            </tr>
          )}
        </tbody>
      )}
    </table>
  );
}

/**
 * The call sites of ONE edge, loaded on demand.
 *
 * `/query` ships an edge as a (from, to) symbol pair plus a count; the call
 * sites live behind `/v1/edge/{from}/{to}/occurrences` and are fetched when
 * the edge is opened (mounting this list IS the intent to see them). Rows
 * arrive in display order — the endpoint pages on `(object, offset, id)` —
 * so each page appends contiguously and no client-side sort is needed.
 */
function EdgeOccurrenceRows({
  from,
  to,
  fileContents,
  ensureFileContent,
  setCodeFocus,
  onAction,
}: {
  from: string;
  to: string;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  setCodeFocus: (type: CodeFocus) => void;
  onAction?: () => void;
}) {
  const fetchPage = useCallback(
    async (after: string | null): Promise<PagedResult<EdgeOccurrenceRowJson>> => {
      const response = await fetchEdgeOccurrences(from, to, after);
      if (!response.ok) {
        throw new Error(`edge occurrences failed (${response.status})`);
      }
      const data: EdgeOccurrencesResponse = await response.json();
      for (const row of data.rows) {
        ensureFileContent(row.object_id);
      }
      return { rows: data.rows, next: data.next, total: null };
    },
    [from, to, ensureFileContent],
  );
  const { rows, next, error, loaded, loading, loadMore } = usePagedList(`${from}\u0000${to}`, fetchPage);

  return (
    <>
      {rows.map((row) => (
        <EdgeOccurrenceRow
          key={row.ref_id}
          row={row}
          fileContents={fileContents}
          setCodeFocus={setCodeFocus}
          onAction={onAction}
        />
      ))}
      {error && (
        <tr className="declaration-hover">
          <td colSpan={3} data-testid="edge-occurrences-error">
            {error}
          </td>
        </tr>
      )}
      {(loading || next) && (
        <tr className="declaration-hover">
          <td colSpan={3}>
            {loading ? (
              <span>Loading…</span>
            ) : (
              <button
                type="button"
                className="node-hover-text-btn"
                data-testid={`load-edge-occurrences-${from}-${to}`}
                onClick={(event) => {
                  event.stopPropagation();
                  loadMore();
                }}
              >
                Load more
              </button>
            )}
          </td>
        </tr>
      )}
      {loaded && !loading && rows.length === 0 && !error && (
        <tr className="declaration-hover">
          <td colSpan={3}>No call sites</td>
        </tr>
      )}
    </>
  );
}

/** One fetched call site: path, location, open/copy actions. */
function EdgeOccurrenceRow({
  row,
  fileContents,
  setCodeFocus,
  onAction,
}: {
  row: EdgeOccurrenceRowJson;
  fileContents: Map<string, string>;
  setCodeFocus: (type: CodeFocus) => void;
  onAction?: () => void;
}) {
  const location = formatOffsetLocation(fileContents.get(row.object_id), row.start_offset);

  function openInEditor() {
    setCodeFocus({
      object_id: row.object_id,
      start_offset: row.start_offset,
      end_offset: row.end_offset,
      path: row.path,
      project_id: row.project_id,
    });
  }

  return (
    <tr
      className="declaration-hover"
      data-testid={`edge-occurrence-${row.ref_id}`}
      onClick={openInEditor}
    >
      <td>{row.path}</td>
      <td>{location}</td>
      <td className="node-hover-actions-cell">
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            openInEditor();
          }}
          title="Open in editor"
        >
          <LuArrowUpRight />
        </button>
        <button
          type="button"
          className="node-hover-icon"
          onClick={(event) => {
            event.stopPropagation();
            void copyToClipboard(row.path);
            onAction?.();
          }}
          title="Copy path"
        >
          <LuCopy />
        </button>
      </td>
    </tr>
  );
}

/**
 * Reference edges hidden by the redundancy filter, shown on the node hover.
 * Each entry is a (from, to) pair with its call-site count; expanding one
 * loads its call sites.
 */
function HiddenReferencesSection({
  edges,
  graph,
  setCodeFocus,
  fileContents,
  ensureFileContent,
  onAction,
}: {
  edges: Array<Edge>;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  onAction?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [openPairs, setOpenPairs] = useState<Set<string>>(new Set());

  function togglePair(id: string) {
    setOpenPairs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <table>
      <SectionHeader name="References" expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      {expanded && (
        <tbody>
          {edges.map((edge) => {
            const targetLabel = graph.nodes.get(edge.to)?.label ?? edge.to;
            const isOpen = openPairs.has(edge.id);
            return (
              <React.Fragment key={edge.id}>
                <tr
                  className="declaration-hover"
                  data-testid={`hidden-ref-${edge.id}`}
                  onClick={() => togglePair(edge.id)}
                >
                  <td colSpan={2}>
                    <span className="section-header-chevron">
                      {isOpen ? <LuChevronDown /> : <LuChevronRight />}
                    </span>
                    {targetLabel}
                  </td>
                  <td>{edge.occurrence_count}</td>
                </tr>
                {isOpen && (
                  <EdgeOccurrenceRows
                    from={edge.from_symbol}
                    to={edge.to_symbol}
                    fileContents={fileContents}
                    ensureFileContent={ensureFileContent}
                    setCodeFocus={setCodeFocus}
                    onAction={onAction}
                  />
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      )}
    </table>
  );
}

export interface EdgesHoverProps {
  edges: Array<Edge>;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  onAction?: () => void;
}

/** The edge context menu: which symbols it connects, and its call sites. */
export function EdgesHover({
  edges,
  setCodeFocus,
  graph,
  fileContents,
  ensureFileContent,
  onAction,
}: EdgesHoverProps) {
  const headerEdge = edges[0];
  const fromLabel = headerEdge ? graph.nodes.get(headerEdge.from)?.label ?? headerEdge.from : null;
  const toLabel = headerEdge ? graph.nodes.get(headerEdge.to)?.label ?? headerEdge.to : null;

  return (
    <div className="node-hover">
      {headerEdge && (
        <div className="edge-hover-header">
          <div className="edge-hover-line">
            <span className="edge-hover-key">From</span>
            <span className="edge-hover-value" title={fromLabel ?? undefined}>
              {fromLabel}
            </span>
          </div>
          <div className="edge-hover-line">
            <span className="edge-hover-key">To</span>
            <span className="edge-hover-value" title={toLabel ?? undefined}>
              {toLabel}
            </span>
          </div>
        </div>
      )}
      <table>
        <tbody>
          {headerEdge && (
            <EdgeOccurrenceRows
              from={headerEdge.from_symbol}
              to={headerEdge.to_symbol}
              fileContents={fileContents}
              ensureFileContent={ensureFileContent}
              setCodeFocus={setCodeFocus}
              onAction={onAction}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
