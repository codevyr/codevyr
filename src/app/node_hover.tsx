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
  instance: SymbolInstance;
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
}

function SymbolInstanceHover({ instance, graph, setCodeFocus, fileContents, onAction }: SymbolInstanceHoverProps) {
  const filePath = graph.objects.get(instance.object_id)?.path ?? 'Undefined';
  const location = formatOffsetLocation(
    fileContents.get(instance.object_id),
    instance.start_offset,
  );

  function openInEditor() {
    setCodeFocus({
      object_id: instance.object_id,
      start_offset: instance.start_offset,
      end_offset: instance.end_offset,
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
  instances: SymbolInstance[];
  graph: Graph;
  setCodeFocus: (type: CodeFocus) => void;
  fileContents: Map<string, string>;
  onAction?: () => void;
}

function capitalizeInstanceType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function NodeHoverSection({
  sectionName,
  instances,
  graph,
  setCodeFocus,
  fileContents,
  onAction,
}: NodeHoverSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (instances.length === 0) {
    return null;
  }

  const sortedInstances = [...instances].sort((left, right) =>
    compareSymbolInstances(left, right, graph, fileContents),
  );

  return (
    <>
      <SectionHeader name={sectionName} expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      {expanded && (
        <tbody>
          {sortedInstances.map((instance) => (
            <SymbolInstanceHover
              key={instance.id}
              instance={instance}
              graph={graph}
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
  revealDirectory?: (objectId: string) => void;
  hiddenRefEdges?: Array<Edge>;
  /** Raw symbol ids whose out-edges the server truncated (fetch-more). */
  truncatedRefSymbols?: Array<string>;
  /** (symbol, exact total) pairs whose instance list the server truncated. */
  truncatedInstances?: Array<{ symbol: string; total: number }>;
  revealQueryRange?: (start: number, end: number) => void;
  onAction?: () => void;
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
  truncatedInstances,
  revealQueryRange,
  onAction,
}: NodeHoverProps) {
  // Fetched instance pages, keyed by truncated symbol. ONE load control
  // serves the whole hover: instances render grouped by type, so a per-type
  // or per-symbol button would be meaningless — fetched rows merge into the
  // typed sections below and every truncated symbol pages together.
  const [fetchedPages, setFetchedPages] = useState<
    Map<string, { rows: SymbolInstancePageRowJson[]; next: string | number | null; loaded: boolean }>
  >(new Map());
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const truncated = truncatedInstances ?? [];

  async function loadMoreInstances() {
    setInstancesLoading(true);
    setInstancesError(null);
    try {
      const nextPages = new Map(fetchedPages);
      for (const { symbol } of truncated) {
        const page = nextPages.get(symbol);
        if (page && page.loaded && page.next === null) {
          continue; // this symbol's listing is exhausted
        }
        const after = page?.loaded ? page.next : null;
        const response = await fetchSymbolInstances(symbol, after);
        if (!response.ok) {
          throw new Error(`instances request failed (${response.status})`);
        }
        const data: SymbolInstancesResponse = await response.json();
        nextPages.set(symbol, {
          rows: [...(page?.rows ?? []), ...data.rows],
          next: data.next,
          loaded: true,
        });
      }
      setFetchedPages(nextPages);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // superseded by a newer fetch — not an error state
      }
      setInstancesError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstancesLoading(false);
    }
  }

  // Merge fetched rows into the node's instances, deduped by id (the
  // shipped instances are priority-ordered, pages are id-ordered — overlap
  // is expected, not a bug).
  const allFetchedRows: SymbolInstancePageRowJson[] = [];
  fetchedPages.forEach((page) => allFetchedRows.push(...page.rows));
  const knownIds = new Set(node.symbol_instances.map((inst) => inst.id));
  const fetchedInstances: SymbolInstance[] = [];
  fetchedPages.forEach((page, symbol) => {
    for (const row of page.rows) {
      if (!knownIds.has(row.id)) {
        knownIds.add(row.id);
        fetchedInstances.push(instanceRowToSymbolInstance(row, symbol));
      }
    }
  });
  const allInstances = [...node.symbol_instances, ...fetchedInstances];
  // Fetched rows may reference files the graph never shipped; overlay their
  // paths so rendering and sorting resolve.
  const hoverGraph =
    allFetchedRows.length > 0
      ? { ...graph, objects: overlayObjects(graph.objects, allFetchedRows) }
      : graph;

  // "N of M shown": M sums the truncated symbols' exact totals plus any
  // shipped instances of symbols that were NOT truncated.
  const truncatedSymbols = new Set(truncated.map((t) => t.symbol));
  const totalAvailable =
    truncated.reduce((sum, t) => sum + t.total, 0) +
    node.symbol_instances.filter((inst) => !truncatedSymbols.has(inst.symbol)).length;
  const hasMoreInstances = truncated.some(({ symbol }) => {
    const page = fetchedPages.get(symbol);
    return !page || !page.loaded || page.next !== null;
  });

  // For group nodes, separate directory instances from real code references
  const realInstances = isGroupNode
    ? allInstances.filter((inst) => !isDirectoryInstance(inst))
    : allInstances;
  const selfRefInstance = isGroupNode
    ? node.symbol_instances.find((inst) => isSelfReference(inst)) ?? node.symbol_instances.find((inst) => isDirectoryInstance(inst))
    : undefined;

  // Group instances by instance_type, skipping "unspecified"
  const instancesByType = new Map<string, SymbolInstance[]>();
  realInstances.forEach((instance) => {
    const type = instance.instance_type;
    if (type === 'unspecified') return;
    if (!instancesByType.has(type)) {
      instancesByType.set(type, []);
    }
    instancesByType.get(type)!.push(instance);
  });

  // Warm the file cache for the instances rendered here. Hidden-reference
  // call sites are no longer prefetched: they arrive with their own
  // `ensureFileContent` when their edge is expanded.
  useEffect(() => {
    const seen = new Set<string>();
    realInstances.forEach((instance) => {
      if (seen.has(instance.object_id)) {
        return;
      }
      seen.add(instance.object_id);
      ensureFileContent(instance.object_id);
    });
  }, [node, ensureFileContent, realInstances]);

  const dirPath = selfRefInstance
    ? graph.objects.get(selfRefInstance.object_id)?.path
    : undefined;

  return (
    <div className="node-hover">
      <div className="node-hover-header">
        <div className="node-hover-title" title={node.label}>
          {node.label}
        </div>
        {isGroupNode && revealDirectory && selfRefInstance && (
          <button
            type="button"
            className="node-hover-icon"
            onClick={() => revealDirectory(selfRefInstance.object_id)}
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
      {isGroupNode && realInstances.length === 0 && dirPath && (
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
          .map(([typeName, instances]) => (
          <NodeHoverSection
            key={typeName}
            sectionName={capitalizeInstanceType(typeName)}
            instances={instances}
            graph={hoverGraph}
            setCodeFocus={setCodeFocus}
            fileContents={fileContents}
            onAction={onAction}
          />
        ))}
        {truncated.length > 0 && (
          <tbody data-testid="load-instances-row">
            {instancesError && (
              <tr>
                <td colSpan={3} data-testid="instances-error">
                  {instancesError}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={3}>
                <span>{formatMoreInstancesLabel(allInstances.length, totalAvailable)}</span>
                {hasMoreInstances && (
                  <button
                    type="button"
                    className="node-hover-text-btn"
                    data-testid="load-instances-more"
                    disabled={instancesLoading}
                    style={{ marginLeft: '0.5rem' }}
                    onClick={(event) => {
                      event.stopPropagation();
                      void loadMoreInstances();
                    }}
                  >
                    {instancesLoading ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </td>
            </tr>
          </tbody>
        )}
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
  const [rows, setRows] = useState<Array<EdgeOccurrenceRowJson>>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadPage = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchEdgeOccurrences(from, to, after);
        if (!response.ok) {
          throw new Error(`edge occurrences failed (${response.status})`);
        }
        const data: EdgeOccurrencesResponse = await response.json();
        setRows((prev) => (after ? [...prev, ...data.rows] : data.rows));
        setNext(data.next);
        setLoaded(true);
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
    },
    [from, to, ensureFileContent],
  );

  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

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
                  void loadPage(next);
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
