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
