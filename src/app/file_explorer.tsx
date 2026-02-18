'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchProjectTree,
  fetchProjects,
  resolveProjectPath,
  type ProjectResolveNode,
  type ProjectSummary,
  type ProjectTreeNode,
} from './askld';
import {
  LuChevronDown,
  LuChevronRight,
  LuFile,
  LuFolder,
  LuFolderOpen,
} from 'react-icons/lu';

type FileNode = {
  projectId: string;
  name: string;
  path: string;
  node_type: 'dir' | 'file';
  has_children: boolean;
  file_id?: string | null;
  filetype?: string | null;
  children: string[] | null;
  childrenLoaded?: boolean;
  isLoading?: boolean;
};

type FileLocation = {
  projectId: string;
  path: string;
};

type FileExplorerProps = {
  activeFileId: string | null;
  onOpenFile: (fileId: string, path: string, projectId: string, fileType?: string | null) => void;
};

type RowItem =
  | { kind: 'project'; project: ProjectSummary }
  | { kind: 'node'; node: FileNode; depth: number };

const projectKey = (projectId: string) => `project:${projectId}`;
const nodeKey = (projectId: string, path: string) => `node:${projectId}:${path}`;

const iconClassName = 'h-4 w-4';

function getBaseName(path: string) {
  const trimmed = path.replace(/\\/g, '/');
  const segments = trimmed.split('/').filter(Boolean);
  if (segments.length === 0) {
    return trimmed || '/';
  }
  return segments[segments.length - 1];
}

function sortTreeNodes(nodes: ProjectTreeNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.node_type !== b.node_type) {
      return a.node_type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function buildDirPaths(path: string, rootPath: string) {
  const segments = path.split('/').filter(Boolean);
  const rootSegments = rootPath.split('/').filter(Boolean);
  const dirPaths: string[] = [];
  if (rootSegments.length > segments.length) {
    return dirPaths;
  }
  let current = '';
  for (let index = 0; index < segments.length - 1; index += 1) {
    current += `/${segments[index]}`;
    if (index >= rootSegments.length - 1) {
      dirPaths.push(current);
    }
  }
  return dirPaths;
}

function ensurePathChain(projectId: string, dirPaths: string[], nodeMap: Map<string, FileNode>, baseParentKey: string | null) {
  if (dirPaths.length === 0) {
    return nodeMap;
  }
  const next = new Map(nodeMap);
  let parentKey = baseParentKey;
  dirPaths.forEach((dirPath, index) => {
    const key = nodeKey(projectId, dirPath);
    if (!next.has(key)) {
      next.set(key, {
        projectId,
        name: getBaseName(dirPath),
        path: dirPath,
        node_type: 'dir',
        has_children: true,
        children: null,
        childrenLoaded: false,
      });
    }
    if (parentKey) {
      const parent = next.get(parentKey);
      if (parent) {
        const children = parent.children ? [...parent.children] : [];
        if (!children.includes(key)) {
          children.push(key);
        }
        next.set(parentKey, {
          ...parent,
          children,
        });
      }
    }
    parentKey = key;
  });
  return next;
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

export function FileExplorer({ activeFileId, onOpenFile }: FileExplorerProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nodeMap, setNodeMap] = useState<Map<string, FileNode>>(() => new Map());
  const nodeMapRef = useRef(nodeMap);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [activePathKey, setActivePathKey] = useState<string | null>(null);
  const fileIdLookupRef = useRef<Map<string, FileLocation>>(new Map());
  const loadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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
            const rootKey = nodeKey(project.id, '/');
            if (!next.has(rootKey)) {
              next.set(rootKey, {
                projectId: project.id,
                name: '/',
                path: '/',
                node_type: 'dir',
                has_children: true,
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

  const loadDirectory = useCallback(async (projectId: string, path: string) => {
    const key = nodeKey(projectId, path);
    const existing = nodeMapRef.current.get(key);
    if (!existing || existing.node_type !== 'dir') {
      return;
    }
    if (existing.childrenLoaded) {
      return;
    }

    const cachedPromise = loadPromisesRef.current.get(key);
    if (cachedPromise) {
      return cachedPromise;
    }

    setNodeMap((prev) => {
      const next = new Map(prev);
      const target = next.get(key);
      if (target) {
        next.set(key, { ...target, isLoading: true });
      }
      nodeMapRef.current = next;
      return next;
    });

    const promise = fetchProjectTree(projectId, path, 1)
      .then((response) => readJsonResponse<ProjectTreeNode[]>(response, 'Tree request'))
      .then((data) => {
        setNodeMap((prev) => {
          const next = new Map(prev);
          const parent = next.get(key);
          const childrenKeys: string[] = [];
          const sortedChildren = sortTreeNodes(data);
          sortedChildren.forEach((child) => {
            const childKey = nodeKey(projectId, child.path);
            const node: FileNode = {
              projectId,
              name: child.name,
              path: child.path,
              node_type: child.node_type,
              has_children: child.has_children,
              file_id: child.file_id ?? null,
              filetype: child.filetype ?? null,
              children: child.node_type === 'dir' ? null : [],
              childrenLoaded: child.node_type !== 'dir',
            };
            next.set(childKey, node);
            childrenKeys.push(childKey);
            if (child.file_id) {
              fileIdLookupRef.current.set(child.file_id, {
                projectId,
                path: child.path,
              });
            }
          });
          if (parent) {
            next.set(key, {
              ...parent,
              children: childrenKeys,
              isLoading: false,
              childrenLoaded: true,
            });
          }
          nodeMapRef.current = next;
          return next;
        });
      })
      .catch((error) => {
        console.error('Failed to load directory', error);
        setNodeMap((prev) => {
          const next = new Map(prev);
          const parent = next.get(key);
          if (parent) {
            next.set(key, { ...parent, isLoading: false, children: [] });
          }
          nodeMapRef.current = next;
          return next;
        });
      })
      .finally(() => {
        loadPromisesRef.current.delete(key);
      });

    loadPromisesRef.current.set(key, promise);
    return promise;
  }, []);

  const expandKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      if (prev.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const collapseKey = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      if (!prev.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleProject = useCallback((projectId: string) => {
    const key = projectKey(projectId);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (!expandedKeys.has(key)) {
      loadDirectory(projectId, '/');
    }
  }, [expandedKeys, loadDirectory]);

  const toggleDirectory = useCallback((node: FileNode) => {
    if (!node.has_children) {
      return;
    }
    const key = nodeKey(node.projectId, node.path);
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      return next;
    });
    if (node.children === null && node.has_children) {
      loadDirectory(node.projectId, node.path);
    }
  }, [loadDirectory]);

  const handleFileClick = useCallback((node: FileNode) => {
    if (!node.file_id) {
      return;
    }
    fileIdLookupRef.current.set(node.file_id, {
      projectId: node.projectId,
      path: node.path,
    });
    setActivePathKey(nodeKey(node.projectId, node.path));
    onOpenFile(node.file_id, node.path, node.projectId, node.filetype ?? null);
  }, [onOpenFile]);

  const resolveActiveFile = useCallback(async (fileId: string, projectList: ProjectSummary[]) => {
    const cached = fileIdLookupRef.current.get(fileId);
    if (cached) {
      const dirPaths = buildDirPaths(cached.path, '/');
      return {
        projectId: cached.projectId,
        path: cached.path,
        dirPaths,
      };
    }

    for (const project of projectList) {
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
        const location = { projectId: project.id, path: leaf.path };
        fileIdLookupRef.current.set(fileId, location);
        const dirPaths = buildDirPaths(leaf.path, '/');
        return { projectId: project.id, path: leaf.path, dirPaths };
      } catch (error) {
        console.error('Failed to resolve file path', error);
      }
    }

    return null;
  }, []);

  const revealActiveFile = useCallback(async (fileId: string, projectList: ProjectSummary[]) => {
    const resolved = await resolveActiveFile(fileId, projectList);
    if (!resolved) {
      return;
    }

    const { projectId, path, dirPaths } = resolved;
    const project = projectList.find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    const visibleDirPaths = dirPaths?.filter((dirPath) => dirPath !== '/');
    if (visibleDirPaths && visibleDirPaths.length > 0) {
      const rootKey = nodeKey(projectId, '/');
      const next = ensurePathChain(projectId, visibleDirPaths, nodeMapRef.current, rootKey);
      nodeMapRef.current = next;
      setNodeMap(next);
    }

    if (visibleDirPaths && visibleDirPaths.length > 0) {
      expandKey(projectKey(projectId));
      for (const dirPath of visibleDirPaths) {
        expandKey(nodeKey(projectId, dirPath));
        await loadDirectory(projectId, dirPath);
      }
    }

    setActivePathKey(nodeKey(projectId, path));
  }, [expandKey, loadDirectory, resolveActiveFile]);

  useEffect(() => {
    if (!activeFileId) {
      setActivePathKey(null);
      return;
    }
    if (projects.length === 0) {
      return;
    }
    revealActiveFile(activeFileId, projects);
  }, [activeFileId, projects, revealActiveFile]);

  const rows = useMemo(() => {
    const items: RowItem[] = [];
    const appendNode = (node: FileNode, depth: number) => {
      items.push({ kind: 'node', node, depth });
      const key = nodeKey(node.projectId, node.path);
      if (!expandedKeys.has(key) || !node.children || node.children.length === 0) {
        return;
      }
      node.children
        .map((childKey) => nodeMap.get(childKey))
        .filter((child): child is FileNode => Boolean(child))
        .forEach((child) => {
          appendNode(child, depth + 1);
        });
    };
    const appendChildren = (node: FileNode, depth: number) => {
      if (!node.children || node.children.length === 0) {
        return;
      }
      node.children
        .map((childKey) => nodeMap.get(childKey))
        .filter((child): child is FileNode => Boolean(child))
        .forEach((child) => {
          appendNode(child, depth);
        });
    };
    projects.forEach((project) => {
      items.push({ kind: 'project', project });
      if (!expandedKeys.has(projectKey(project.id))) {
        return;
      }
      const rootKey = nodeKey(project.id, '/');
      const rootNode = nodeMap.get(rootKey);
      if (!rootNode) {
        return;
      }
      appendChildren(rootNode, 1);
    });
    return items;
  }, [expandedKeys, nodeMap, projects]);

  useEffect(() => {
    if (!activePathKey) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    const selector = `[data-node-key="${activePathKey}"]`;
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }, [activePathKey, rows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Explorer
      </div>
      <div className="flex-1 overflow-auto text-sm" ref={scrollContainerRef}>
        {rows.map((item) => {
          if (item.kind === 'project') {
            const project = item.project;
            const isExpanded = expandedKeys.has(projectKey(project.id));
            return (
              <button
                key={projectKey(project.id)}
                type="button"
                className="flex w-full items-center gap-2 px-2 py-1 text-left font-semibold text-gray-700 hover:bg-gray-100"
                onClick={() => toggleProject(project.id)}
              >
                {isExpanded ? (
                  <LuChevronDown className={iconClassName} />
                ) : (
                  <LuChevronRight className={iconClassName} />
                )}
                <span>{project.project_name}</span>
              </button>
            );
          }

          const { node, depth } = item;
          const nodeIsExpanded = expandedKeys.has(nodeKey(node.projectId, node.path));
          const isDir = node.node_type === 'dir';
          const isActive = activePathKey === nodeKey(node.projectId, node.path);
          const canExpand = isDir && node.has_children;
          const paddingLeft = Math.max(0, depth * 12);

          return (
            <button
              key={nodeKey(node.projectId, node.path)}
              type="button"
              data-node-key={nodeKey(node.projectId, node.path)}
              className={[
                'flex w-full items-center gap-2 px-2 py-1 text-left',
                isActive ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-100',
              ].join(' ')}
              style={{ paddingLeft }}
              onClick={() => {
                if (isDir) {
                  toggleDirectory(node);
                } else {
                  handleFileClick(node);
                }
              }}
            >
              <span className="flex w-4 items-center justify-center">
                {canExpand ? (
                  nodeIsExpanded ? (
                    <LuChevronDown className={iconClassName} />
                  ) : (
                    <LuChevronRight className={iconClassName} />
                  )
                ) : null}
              </span>
              {isDir ? (
                nodeIsExpanded ? (
                  <LuFolderOpen className={iconClassName} />
                ) : (
                  <LuFolder className={iconClassName} />
                )
              ) : (
                <LuFile className={iconClassName} />
              )}
              <span className="truncate">{node.name}</span>
              {node.isLoading ? (
                <span className="ml-auto text-xs text-gray-400">Loading...</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
