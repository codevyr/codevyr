export const askldUrl = process.env.NEXT_PUBLIC_ASKLD_URL || 'https://api.codevyr.com';

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
  name: string;
  path: string;
  node_type: TreeNodeType;
  has_children: boolean;
  file_id?: string | null;
}

export interface ProjectResolveNode {
  name: string;
  path: string;
}

export function fetchQuery(query: string): Promise<Response> {
  console.log(`${askldUrl}`, query);
  return fetch(`${askldUrl}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: query
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

export function fetchProjectTree(projectId: string, path: string, depth = 1): Promise<Response> {
  const params = new URLSearchParams();
  params.set('path', path);
  params.set('depth', String(depth));
  return fetch(`${askldUrl}/v1/index/projects/${projectId}/tree?${params.toString()}`, {
    method: 'GET',
  });
}

export function resolveProjectPath(projectId: string, options: { fileId?: string; path?: string }): Promise<Response> {
  const params = new URLSearchParams();
  if (options.fileId) {
    params.set('file_id', options.fileId);
  }
  if (options.path) {
    params.set('path', options.path);
  }
  return fetch(`${askldUrl}/v1/index/projects/${projectId}/resolve?${params.toString()}`, {
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
