import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  fetchProjectTree,
  fetchProjects,
  resolveProjectPath,
  type ProjectResolveNode,
  type ProjectSummary,
  type ProjectTreeNode,
  type ProjectTreeResponse,
} from '../askld';
import { ROOT_PATH, buildAncestorPaths, getBaseName, normalizePath } from './paths';

export type FileNode = {
  projectId: string;
  name: string;
  path: string;
  node_type: 'dir' | 'file';
  has_children: boolean;
  file_id?: string | null;
  filetype?: string | null;
  compact_path?: string | null;
  children: string[] | null;
  childrenLoaded?: boolean;
};

type FileLocation = {
  projectId: string;
  path: string;
};

type NormalizedTreeResponse = {
  basePath: string;
  nodes: ProjectTreeNode[];
  expanded: Record<string, ProjectTreeNode[]>;
};

export type FileTreeCache = {
  projects: ProjectSummary[];
  nodeMap: Map<string, FileNode>;
  loadDirectory: (projectId: string, path: string) => Promise<void>;
  ensurePath: (projectId: string, targetPath: string) => Promise<void>;
  resolveFileLocation: (fileId: string) => Promise<FileLocation | null>;
  getFileLocation: (fileId: string) => FileLocation | null;
  registerFileLocation: (fileId: string, projectId: string, path: string) => void;
};

const nodeKey = (projectId: string, path: string) => `node:${projectId}:${path}`;

function normalizeTreeResponse(
  data: ProjectTreeResponse,
  fallbackBasePath: string,
): NormalizedTreeResponse {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const expanded = data.expanded && typeof data.expanded === 'object' ? data.expanded : {};
  const basePath =
    (typeof data.base_path === 'string' && data.base_path.length > 0 ? data.base_path : null) ??
    fallbackBasePath;
  return { basePath, nodes, expanded };
}

function applyTreeChildren(
  next: Map<string, FileNode>,
  projectId: string,
  nodes: ProjectTreeNode[],
  fileIdLookup: MutableRefObject<Map<string, FileLocation>>,
) {
  const childrenKeys: string[] = [];
  const seenPaths = new Set<string>();
  nodes.forEach((child) => {
    const childPath = normalizePath(child.path);
    if (seenPaths.has(childPath)) {
      return;
    }
    seenPaths.add(childPath);
    const childKey = nodeKey(projectId, childPath);
    const isDir = child.node_type === 'dir';
    const hasChildren = child.has_children;
    const childrenLoaded = !isDir || !hasChildren;
    const node: FileNode = {
      projectId,
      name: child.name ?? getBaseName(childPath),
      path: childPath,
      node_type: child.node_type,
      has_children: hasChildren,
      file_id: child.file_id ?? null,
      filetype: child.filetype ?? null,
      compact_path: child.compact_path ? normalizePath(child.compact_path) : null,
      children: isDir ? (hasChildren ? null : []) : [],
      childrenLoaded,
    };
    const existing = next.get(childKey);
    if (existing) {
      const keepChildren = existing.childrenLoaded && existing.children ? existing.children : node.children;
      const merged: FileNode = {
        ...existing,
        ...node,
        file_id: node.file_id ?? existing.file_id ?? null,
        filetype: node.filetype ?? existing.filetype ?? null,
        compact_path: node.compact_path ?? existing.compact_path ?? null,
        children: keepChildren,
        childrenLoaded: existing.childrenLoaded || node.childrenLoaded,
      };
      next.set(childKey, merged);
    } else {
      next.set(childKey, node);
    }
    childrenKeys.push(childKey);
    if (child.file_id) {
      fileIdLookup.current.set(child.file_id, {
        projectId,
        path: childPath,
      });
    }
  });
  return childrenKeys;
}

async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context} failed (${response.status}). ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`${context} returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

export function useFileTreeCache(): FileTreeCache {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nodeMap, setNodeMap] = useState<Map<string, FileNode>>(() => new Map());
  const nodeMapRef = useRef(nodeMap);
  const fileIdLookupRef = useRef<Map<string, FileLocation>>(new Map());
  const loadedChildrenRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    nodeMapRef.current = nodeMap;
  }, [nodeMap]);

  useEffect(() => {
    let canceled = false;
    fetchProjects()
      .then((response) => readJsonResponse<ProjectSummary[]>(response, 'Projects request'))
      .then((data) => {
        if (canceled) {
          return;
        }
        setProjects(data);
        setNodeMap((prev) => {
          const next = new Map(prev);
          data.forEach((project) => {
            const rootKey = nodeKey(project.id, ROOT_PATH);
            if (!next.has(rootKey)) {
            next.set(rootKey, {
              projectId: project.id,
              name: ROOT_PATH,
              path: ROOT_PATH,
              node_type: 'dir',
              has_children: true,
              compact_path: null,
              children: null,
              childrenLoaded: false,
            });
            }
          });
          nodeMapRef.current = next;
          return next;
        });
      })
      .catch((error) => {
        console.error('Failed to load projects', error);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const registerFileLocation = useCallback((fileId: string, projectId: string, path: string) => {
    fileIdLookupRef.current.set(fileId, { projectId, path: normalizePath(path) });
  }, []);
  const getFileLocation = useCallback((fileId: string) => {
    return fileIdLookupRef.current.get(fileId) ?? null;
  }, []);

  const fetchAndApplyTree = useCallback(async (projectId: string, basePath: string, expandPaths: string[]) => {
    const normalizedBase = normalizePath(basePath);
    return fetchProjectTree(projectId, normalizedBase, expandPaths)
      .then((response) => readJsonResponse<ProjectTreeResponse>(response, 'Tree request'))
      .then((data) => {
        const normalized = normalizeTreeResponse(data, normalizedBase);
        const normalizedBaseKey = `${projectId}:${normalized.basePath}`;
        setNodeMap((prev) => {
          const next = new Map(prev);
          const parentKey = nodeKey(projectId, normalized.basePath);
          const parent = next.get(parentKey);
          const childrenKeys = applyTreeChildren(
            next,
            projectId,
            normalized.nodes,
            fileIdLookupRef,
          );
          loadedChildrenRef.current.set(normalizedBaseKey, childrenKeys);
          if (parent) {
            next.set(parentKey, {
              ...parent,
              children: childrenKeys,
              childrenLoaded: true,
            });
          } else {
            next.set(parentKey, {
              projectId,
              name: getBaseName(normalized.basePath),
              path: normalized.basePath,
              node_type: 'dir',
              has_children: normalized.nodes.length > 0,
              compact_path: null,
              children: childrenKeys,
              childrenLoaded: true,
            });
          }
          Object.entries(normalized.expanded).forEach(([expandedPath, nodes]) => {
            if (!Array.isArray(nodes)) {
              return;
            }
            const normalizedExpanded = normalizePath(expandedPath);
            const expandedKey = nodeKey(projectId, normalizedExpanded);
            const existingExpanded = next.get(expandedKey);
            const expandedChildren = applyTreeChildren(
              next,
              projectId,
              nodes,
              fileIdLookupRef,
            );
            loadedChildrenRef.current.set(`${projectId}:${normalizedExpanded}`, expandedChildren);
            const expandedNode: FileNode = existingExpanded ?? {
              projectId,
              name: getBaseName(normalizedExpanded),
              path: normalizedExpanded,
              node_type: 'dir',
              has_children: nodes.length > 0,
              compact_path: null,
              children: null,
              childrenLoaded: false,
            };
            next.set(expandedKey, {
              ...expandedNode,
              children: expandedChildren,
              has_children: nodes.length > 0 ? true : expandedNode.has_children,
              childrenLoaded: true,
            });
          });
          nodeMapRef.current = next;
          return next;
        });
      })
      .catch((error) => {
        console.error('Failed to load directory', error);
      });
  }, []);

  const hydrateCachedNodes = useCallback((projectId: string, targetPath: string) => {
    const normalizedTarget = normalizePath(targetPath);
    const dirPaths = buildAncestorPaths(normalizedTarget, false);
    const candidatePaths = [ROOT_PATH, ...dirPaths];

    setNodeMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      candidatePaths.forEach((path) => {
        const node = next.get(nodeKey(projectId, path));
        if (!node || node.node_type !== 'dir' || node.childrenLoaded) {
          return;
        }
        const loadPath = normalizePath(node.path);
        const cachedChildren = loadedChildrenRef.current.get(`${projectId}:${loadPath}`);
        if (!cachedChildren) {
          return;
        }
        next.set(nodeKey(projectId, node.path), {
          ...node,
          children: cachedChildren,
          childrenLoaded: true,
        });
        changed = true;
      });
      if (changed) {
        nodeMapRef.current = next;
        return next;
      }
      return prev;
    });
  }, []);

  const loadDirectory = useCallback(async (projectId: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const node = nodeMapRef.current.get(nodeKey(projectId, normalizedPath));
    const loadPath = normalizePath(normalizedPath);
    const loadKey = `${projectId}:${loadPath}`;
    if (node?.childrenLoaded || loadedChildrenRef.current.has(loadKey)) {
      if (!node?.childrenLoaded) {
        const cachedChildren = loadedChildrenRef.current.get(loadKey);
        if (cachedChildren) {
          setNodeMap((prev) => {
            const next = new Map(prev);
            const target = next.get(nodeKey(projectId, normalizedPath));
            if (target) {
              next.set(nodeKey(projectId, normalizedPath), {
                ...target,
                children: cachedChildren,
                childrenLoaded: true,
              });
            }
            nodeMapRef.current = next;
            return next;
          });
        }
      }
      return;
    }

    const missingAncestors = buildAncestorPaths(loadPath, false).filter(
      (dirPath) => !loadedChildrenRef.current.has(`${projectId}:${dirPath}`),
    );
    if (loadPath !== ROOT_PATH && !loadedChildrenRef.current.has(`${projectId}:${ROOT_PATH}`)) {
      missingAncestors.unshift(ROOT_PATH);
    }

    await fetchAndApplyTree(projectId, loadPath, missingAncestors);
  }, [fetchAndApplyTree]);

  const ensurePath = useCallback(async (projectId: string, targetPath: string) => {
    const normalizedTarget = normalizePath(targetPath);
    const dirPaths = buildAncestorPaths(normalizedTarget, false);
    const missingDirs = dirPaths.filter(
      (dirPath) => !loadedChildrenRef.current.has(`${projectId}:${dirPath}`),
    );
    if (!loadedChildrenRef.current.has(`${projectId}:${ROOT_PATH}`)) {
      missingDirs.unshift(ROOT_PATH);
    }
    if (missingDirs.length > 0) {
      await fetchAndApplyTree(projectId, ROOT_PATH, missingDirs);
    }
    hydrateCachedNodes(projectId, normalizedTarget);
  }, [fetchAndApplyTree, hydrateCachedNodes]);

  const resolveFileLocation = useCallback(async (fileId: string) => {
    const cached = fileIdLookupRef.current.get(fileId);
    if (cached) {
      return cached;
    }

    for (const project of projects) {
      try {
        const response = await resolveProjectPath(project.id, { fileId });
        if (!response.ok) {
          continue;
        }
        const ancestors = await readJsonResponse<ProjectResolveNode[]>(response, 'Resolve request');
        const leaf = ancestors[ancestors.length - 1];
        if (!leaf) {
          continue;
        }
        const location = { projectId: project.id, path: normalizePath(leaf.path) };
        fileIdLookupRef.current.set(fileId, location);
        return location;
      } catch (error) {
        console.error('Failed to resolve file path', error);
      }
    }

    return null;
  }, [projects]);

  return useMemo(() => ({
    projects,
    nodeMap,
    loadDirectory,
    ensurePath,
    resolveFileLocation,
    getFileLocation,
    registerFileLocation,
  }), [projects, nodeMap, loadDirectory, ensurePath, resolveFileLocation, getFileLocation, registerFileLocation]);
}
