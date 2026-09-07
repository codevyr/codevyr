import { getRuntimeEnv } from './lib/runtime_env';

const runtimeEnv = getRuntimeEnv();

export const askldUrl =
  runtimeEnv?.NEXT_PUBLIC_ASKLD_URL ||
  process.env.NEXT_PUBLIC_ASKLD_URL ||
  'https://api.codevyr.com';

export interface ProjectSummary {
  id: string;
  project_name: string;
  root_path: string;
}

export interface ProjectDetails extends ProjectSummary {
  modules: number;
  file_count: number;
  symbol_count: number;
}

export type TreeNodeType = 'dir' | 'file';

export interface ProjectTreeNode {
  name?: string;
  path: string;
  node_type: TreeNodeType;
  has_children: boolean;
  file_id?: string | null;
  filetype?: string | null;
  compact_path?: string | null;
}

export interface ProjectTreeResponse {
  base_path?: string;
  nodes?: ProjectTreeNode[];
  expanded?: Record<string, ProjectTreeNode[]>;
}


let queryAbortController: AbortController | null = null;

export function fetchQuery(query: string): Promise<Response> {
  if (queryAbortController) {
    queryAbortController.abort();
  }
  queryAbortController = new AbortController();
  console.log(`${askldUrl}`, query);
  return fetch(`${askldUrl}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: query,
    signal: queryAbortController.signal,
  });
}

/** How much source rides along in the markdown report. */
export type Projection = 'names' | 'signature' | 'body';

/** Build the query string for a markdown query request. Pure, for testing. */
export function markdownQueryParams(projection: Projection): string {
  return new URLSearchParams({ format: 'markdown', projection }).toString();
}

let markdownAbortController: AbortController | null = null;

/**
 * Fetch the same markdown report the MCP renderer produces (backend-rendered,
 * one source of truth). Uses a separate abort controller so it never cancels
 * the main JSON query used by the graph view.
 */
export function fetchQueryMarkdown(query: string, projection: Projection): Promise<Response> {
  if (markdownAbortController) {
    markdownAbortController.abort();
  }
  markdownAbortController = new AbortController();
  return fetch(`${askldUrl}/query?${markdownQueryParams(projection)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: query,
    signal: markdownAbortController.signal,
  });
}

/** One row of a `kind=refs` references page (see askld A2). */
export interface SymbolReferenceRow {
  to_symbol: string;
  to_symbol_name: string;
  to_instance_id: string;
  from_instance_id: string;
  object_id: string;
  path: string;
  project_id: string | null;
  start_offset: number;
  end_offset: number;
}

export interface SymbolReferencesResponse {
  kind: string;
  rows: SymbolReferenceRow[];
  /** Opaque cursor for the next page; null when done. */
  next: string | null;
  /** Row count of this kind; read as `count`+ when `count_capped`. */
  count: number;
  count_capped: boolean;
}

/** Build the query string for a references page request. Pure, for testing. */
export function referencesQueryParams(after?: string | null, limit?: number): string {
  const params = new URLSearchParams();
  if (after) params.set('after', after);
  if (limit !== undefined) params.set('limit', String(limit));
  return params.toString();
}

let referencesAbortController: AbortController | null = null;

/**
 * Page the references out of a symbol the server reported as edge-truncated.
 * Separate abort controller: fetching more must never cancel the main graph
 * query (and a new main query aborts a stale fetch-more via a fresh call).
 */
export function fetchSymbolReferences(
  symbolId: string,
  after?: string | null,
  limit?: number,
): Promise<Response> {
  if (referencesAbortController) {
    referencesAbortController.abort();
  }
  referencesAbortController = new AbortController();
  const qs = referencesQueryParams(after, limit);
  const suffix = qs ? `?${qs}` : '';
  return fetch(`${askldUrl}/v1/symbol/${symbolId}/references${suffix}`, {
    method: 'GET',
    signal: referencesAbortController.signal,
  });
}

/** One row of an instances page (see askld B2). */
export interface SymbolInstancePageRowJson {
  id: string;
  instance_type: string;
  object_id: string;
  path: string;
  project_id: string | null;
  start_offset: number;
  end_offset: number;
}

export interface SymbolInstancesResponse {
  rows: SymbolInstancePageRowJson[];
  /** Instance-id cursor for the next page; null when done. */
  next: string | number | null;
  /** Exact instance count for the symbol. */
  total: number;
}

/** Build the query string for an instances page request. Pure, for testing. */
export function instancesQueryParams(after?: string | number | null, limit?: number): string {
  const params = new URLSearchParams();
  if (after !== undefined && after !== null) params.set('after', String(after));
  if (limit !== undefined) params.set('limit', String(limit));
  return params.toString();
}

let instancesAbortController: AbortController | null = null;

/**
 * Page the instances of a symbol whose list the /query response truncated.
 * Own abort controller for the same reason as fetchSymbolReferences.
 */
export function fetchSymbolInstances(
  symbolId: string,
  after?: string | number | null,
  limit?: number,
): Promise<Response> {
  if (instancesAbortController) {
    instancesAbortController.abort();
  }
  instancesAbortController = new AbortController();
  const qs = instancesQueryParams(after, limit);
  const suffix = qs ? `?${qs}` : '';
  return fetch(`${askldUrl}/v1/symbol/${symbolId}/instances${suffix}`, {
    method: 'GET',
    signal: instancesAbortController.signal,
  });
}

/** One call site of an edge (see /v1/edge/{from}/{to}/occurrences). */
export interface EdgeOccurrenceRowJson {
  ref_id: string;
  from_instance_id: string;
  object_id: string;
  path: string;
  project_id: string | null;
  start_offset: number;
  end_offset: number;
}

export interface EdgeOccurrencesResponse {
  rows: EdgeOccurrenceRowJson[];
  /** Opaque display-order cursor for the next page; null when done. */
  next: string | null;
}

let edgeOccurrencesAbortController: AbortController | null = null;

/**
 * Page the call sites of one edge. `/query` ships only the (from, to) pair and
 * a count; the call sites load when the edge is opened. Own abort controller
 * so it never cancels the main query or another detail fetch.
 */
export function fetchEdgeOccurrences(
  fromSymbol: string,
  toSymbol: string,
  after?: string | null,
  limit?: number,
): Promise<Response> {
  if (edgeOccurrencesAbortController) {
    edgeOccurrencesAbortController.abort();
  }
  edgeOccurrencesAbortController = new AbortController();
  const qs = instancesQueryParams(after, limit);
  const suffix = qs ? `?${qs}` : '';
  return fetch(
    `${askldUrl}/v1/edge/${fromSymbol}/${toSymbol}/occurrences${suffix}`,
    { method: 'GET', signal: edgeOccurrencesAbortController.signal },
  );
}

export function fetchProjects(): Promise<Response> {
  return fetch(`${askldUrl}/v1/index/projects`, {
    method: 'GET',
  });
}

export function fetchProjectDetails(projectId: string): Promise<Response> {
  return fetch(`${askldUrl}/v1/index/projects/${projectId}`, {
    method: 'GET',
  });
}

export function fetchProjectTree(projectId: string, path: string, expandPaths?: string[]): Promise<Response> {
  const params = new URLSearchParams();
  params.set('path', path);
  if (expandPaths && expandPaths.length > 0) {
    const uniquePaths = Array.from(new Set(expandPaths));
    uniquePaths.forEach((expandPath) => {
      params.append('expand[]', expandPath);
    });
  }
  return fetch(`${askldUrl}/v1/index/projects/${projectId}/tree?${params.toString()}`, {
    method: 'GET',
  });
}

export function fetchSourceByPath(
  projectId: string,
  path: string,
  startOffset?: number,
  endOffset?: number,
): Promise<Response> {
  const params = new URLSearchParams();
  params.set('path', path);
  if (startOffset !== undefined) {
    params.set('start_offset', String(startOffset));
  }
  if (endOffset !== undefined) {
    params.set('end_offset', String(endOffset));
  }
  return fetch(`${askldUrl}/v1/index/projects/${projectId}/source?${params.toString()}`, {
    method: 'GET',
  });
}

export function fetchSource(fileId: string, startOffset?: number, endOffset?: number): Promise<Response> {
  const params = new URLSearchParams();
  if (startOffset !== undefined) {
    params.set('start_offset', String(startOffset));
  }
  if (endOffset !== undefined) {
    params.set('end_offset', String(endOffset));
  }
  const query = params.toString();
  const suffix = query.length > 0 ? `?${query}` : '';
  return fetch(`${askldUrl}/source/${fileId}${suffix}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
}
