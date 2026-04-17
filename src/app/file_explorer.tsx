'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode, FileTreeCache } from './lib/file_tree_cache';
import type { ProjectSummary } from './askld';
import { ROOT_PATH, getBaseName, isPathPrefix, normalizePath } from './lib/paths';
import { copyToClipboard } from './lib/clipboard';
import {
  LuChevronDown,
  LuChevronRight,
  LuFile,
  LuFolder,
  LuFolderOpen,
} from 'react-icons/lu';

type FileExplorerProps = {
  cache: FileTreeCache;
  activeFileId: string | null;
  activeFileNonce: number;
  revealRequest?: { fileId: string; projectId: string; path: string; nonce: number } | null;
  onOpenFile: (fileId: string, path: string, projectId: string, fileType?: string | null) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  name: string;
  path: string;
} | null;

type UserOverride = 'expand' | 'collapse';
type UserOverrideEntry = { action: UserOverride; scopeKey?: number };

type RowItem =
  | { kind: 'project'; project: ProjectSummary }
  | { kind: 'node'; node: FileNode; depth: number; displayPath: string; parentPath: string };

const projectKey = (projectId: string) => `project:${projectId}`;
const nodeKey = (projectId: string, path: string) => `node:${projectId}:${path}`;

const iconClassName = 'h-4 w-4';

function getDisplayPath(node: FileNode) {
  return normalizePath(node.compact_path ?? node.path);
}

function buildDisplayLabel(parentPath: string, displayPath: string) {
  const normalizedParent = normalizePath(parentPath);
  const normalizedBase = normalizePath(displayPath);
  if (normalizedParent === ROOT_PATH) {
    return normalizedBase.replace(/^\/+/, '') || ROOT_PATH;
  }
  if (normalizedBase.startsWith(`${normalizedParent}/`)) {
    return normalizedBase.slice(normalizedParent.length + 1) || getBaseName(normalizedBase);
  }
  return getBaseName(normalizedBase);
}

function getDisplayNode(node: FileNode, nodeMap: Map<string, FileNode>) {
  const displayPath = getDisplayPath(node);
  if (displayPath === node.path) {
    return node;
  }
  return nodeMap.get(nodeKey(node.projectId, displayPath)) ?? null;
}

function getChildNodesForDisplay(parent: FileNode, nodeMap: Map<string, FileNode>) {
  const displayNode = getDisplayNode(parent, nodeMap);
  if (!displayNode?.children || displayNode.children.length === 0) {
    return [];
  }
  return displayNode.children
    .map((childKey) => nodeMap.get(childKey))
    .filter((child): child is FileNode => Boolean(child));
}

function sortNodesForDisplay(parentPath: string, nodes: FileNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.node_type !== b.node_type) {
      return a.node_type === 'dir' ? -1 : 1;
    }
    const labelA = buildDisplayLabel(parentPath, getDisplayPath(a));
    const labelB = buildDisplayLabel(parentPath, getDisplayPath(b));
    return labelA.localeCompare(labelB);
  });
}

function findChildOnPath(parent: FileNode, nodeMap: Map<string, FileNode>, targetPath: string): FileNode | null {
  const children = getChildNodesForDisplay(parent, nodeMap);
  if (children.length === 0) {
    return null;
  }
  let best: FileNode | null = null;
  let bestLength = -1;
  children.forEach((child) => {
    if (child.node_type !== 'dir') {
      return;
    }
    const candidate = getDisplayPath(child);
    if (!isPathPrefix(candidate, targetPath)) {
      return;
    }
    if (candidate.length > bestLength) {
      best = child;
      bestLength = candidate.length;
    }
  });
  return best;
}

export function FileExplorer({ cache, activeFileId, activeFileNonce, revealRequest, onOpenFile }: FileExplorerProps) {
  const { projects, nodeMap, loadDirectory, getFileLocation } = cache;
  const nodeMapRef = useRef(nodeMap);
  const [userOverrides, setUserOverrides] = useState<Map<string, UserOverrideEntry>>(
    () => new Map(),
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollKeyRef = useRef<string | null>(null);

  // Track which revealRequest.nonce was current when the active file last changed.
  // If revealRequest.nonce differs from this snapshot, the reveal is newer than the
  // last file open.  Uses the "adjusting state during render" pattern (no refs/effects).
  const [revealNonceAtLastFileOpen, setRevealNonceAtLastFileOpen] = useState(0);
  const [prevActiveFileNonce, setPrevActiveFileNonce] = useState(0);
  if (activeFileNonce !== prevActiveFileNonce) {
    setPrevActiveFileNonce(activeFileNonce);
    if (activeFileNonce > 0) {
      setRevealNonceAtLastFileOpen(revealRequest?.nonce ?? 0);
    }
  }

  // Combined nonce that changes on both file opens and directory reveals,
  // so that manual collapse overrides are invalidated by either action.
  const navigationNonce = Math.max(activeFileNonce, revealRequest?.nonce ?? 0);

  useEffect(() => {
    nodeMapRef.current = nodeMap;
  }, [nodeMap]);

  const buildRevealExpansionKeys = useCallback((projectId: string, targetPath: string, map: Map<string, FileNode>) => {
    const activeMap = map;
    const keys = new Set<string>();
    keys.add(projectKey(projectId));
    let currentKey = nodeKey(projectId, '/');
    const visited = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      if (visited.has(currentKey)) {
        break;
      }
      visited.add(currentKey);
      const current = activeMap.get(currentKey);
      if (!current || current.node_type !== 'dir') {
        break;
      }
      const next = findChildOnPath(current, activeMap, targetPath);
      if (!next) {
        break;
      }
      const nextKey = nodeKey(projectId, next.path);
      keys.add(nextKey);
      currentKey = nextKey;
    }
    return keys;
  }, []);

  const activeLocation = useMemo(() => {
    if (!activeFileId) {
      return null;
    }
    const resolved = getFileLocation(activeFileId);
    if (!resolved) {
      return null;
    }
    return { projectId: resolved.projectId, path: normalizePath(resolved.path) };
  }, [activeFileId, getFileLocation]);

  const revealTarget = useMemo(() => {
    // If a reveal request arrived after the last file open, prefer it.
    // This allows directory reveals to override the active file location.
    const revealIsNewer = revealRequest != null &&
      revealRequest.nonce !== revealNonceAtLastFileOpen;
    if (revealIsNewer) {
      return {
        projectId: revealRequest.projectId,
        path: normalizePath(revealRequest.path),
      };
    }
    if (activeLocation) {
      return activeLocation;
    }
    if (!revealRequest) {
      return null;
    }
    return {
      projectId: revealRequest.projectId,
      path: normalizePath(revealRequest.path),
    };
  }, [activeLocation, revealRequest, revealNonceAtLastFileOpen]);

  const autoExpandedKeys = useMemo(() => {
    if (!revealTarget) {
      return new Set<string>();
    }
    return buildRevealExpansionKeys(revealTarget.projectId, revealTarget.path, nodeMap);
  }, [buildRevealExpansionKeys, nodeMap, revealTarget]);

  const expandedKeys = useMemo(() => {
    const next = new Set(autoExpandedKeys);
    userOverrides.forEach((entry, key) => {
      if (entry.action === 'expand') {
        next.add(key);
      } else if (entry.scopeKey === navigationNonce) {
        next.delete(key);
      }
    });
    return next;
  }, [navigationNonce, autoExpandedKeys, userOverrides]);

  const activePathKey = useMemo(() => {
    if (revealTarget) {
      return nodeKey(revealTarget.projectId, revealTarget.path);
    }
    return null;
  }, [revealTarget]);

  const toggleProject = useCallback((projectId: string) => {
    const key = projectKey(projectId);
    setUserOverrides((prev) => {
      const overrides = new Map(prev);
      if (expandedKeys.has(key)) {
        overrides.set(key, { action: 'collapse', scopeKey: navigationNonce });
      } else {
        overrides.set(key, { action: 'expand' });
      }
      return overrides;
    });
    if (!expandedKeys.has(key)) {
      loadDirectory(projectId, '/');
    }
  }, [navigationNonce, expandedKeys, loadDirectory]);

  const toggleDirectory = useCallback((node: FileNode) => {
    if (node.node_type !== 'dir') {
      return;
    }
    const key = nodeKey(node.projectId, node.path);
    const isExpanded = expandedKeys.has(key);
    const loadPath = node.compact_path ? normalizePath(node.compact_path) : node.path;
    setUserOverrides((prev) => {
      const overrides = new Map(prev);
      if (isExpanded) {
        overrides.set(key, { action: 'collapse', scopeKey: navigationNonce });
      } else {
        overrides.set(key, { action: 'expand' });
      }
      return overrides;
    });
    if (!isExpanded) {
      loadDirectory(node.projectId, loadPath);
    }
  }, [navigationNonce, expandedKeys, loadDirectory]);

  const handleFileClick = useCallback((node: FileNode) => {
    if (!node.file_id) {
      return;
    }
    onOpenFile(node.file_id, node.path, node.projectId, node.filetype ?? null);
  }, [onOpenFile]);

  const rows = useMemo(() => {
    const items: RowItem[] = [];
    const appendNode = (node: FileNode, depth: number, parentPath: string) => {
      const displayPath = getDisplayPath(node);
      items.push({
        kind: 'node',
        node,
        depth,
        displayPath,
        parentPath,
      });
      const key = nodeKey(node.projectId, node.path);
      if (!expandedKeys.has(key)) {
        return;
      }
      const children = sortNodesForDisplay(displayPath, getChildNodesForDisplay(node, nodeMap));
      if (children.length === 0) {
        return;
      }
      children.forEach((child) => {
        appendNode(child, depth + 1, displayPath);
      });
    };
    const appendChildren = (node: FileNode, depth: number) => {
      const displayPath = getDisplayPath(node);
      const children = sortNodesForDisplay(displayPath, getChildNodesForDisplay(node, nodeMap));
      if (children.length === 0) {
        return;
      }
      children.forEach((child) => {
        appendNode(child, depth, displayPath);
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
    pendingScrollKeyRef.current = activePathKey;
  }, [activePathKey]);

  useEffect(() => {
    if (!activePathKey) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    if (pendingScrollKeyRef.current !== activePathKey) {
      return;
    }
    const selector = `[data-node-key="${activePathKey}"]`;
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const isVisible =
      targetRect.top >= containerRect.top &&
      targetRect.bottom <= containerRect.bottom;
    if (isVisible) {
      pendingScrollKeyRef.current = null;
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    pendingScrollKeyRef.current = null;
  }, [activePathKey, rows]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointer = () => {
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('click', handlePointer);
    window.addEventListener('contextmenu', handlePointer);
    window.addEventListener('scroll', handlePointer, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handlePointer);
      window.removeEventListener('contextmenu', handlePointer);
      window.removeEventListener('scroll', handlePointer, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!activePathKey) {
        return;
      }
      const key = event.key.toLowerCase();
      const wantsCopyPath =
        (event.altKey && event.shiftKey && key === 'c') ||
        ((event.metaKey || event.ctrlKey) && event.altKey && key === 'c');
      if (!wantsCopyPath) {
        return;
      }
      const node = nodeMapRef.current.get(activePathKey);
      if (!node) {
        return;
      }
      event.preventDefault();
      void copyToClipboard(getDisplayPath(node));
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [activePathKey]);

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
                data-testid="explorer-project"
                data-project-id={project.id}
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

          const { node, depth, displayPath, parentPath } = item;
          const nodeIsExpanded = expandedKeys.has(nodeKey(node.projectId, node.path));
          const isDir = node.node_type === 'dir';
          const isActive = activePathKey === nodeKey(node.projectId, node.path);
          const displayNode = getDisplayNode(node, nodeMap);
          const hasChildren = displayNode?.has_children ?? node.has_children;
          const childrenLoaded = displayNode?.childrenLoaded ?? node.childrenLoaded;
          const canExpand = isDir && (hasChildren || childrenLoaded === false);
          const paddingLeft = Math.max(0, depth * 12);
          const displayLabel = buildDisplayLabel(parentPath, displayPath);

          return (
            <button
              key={nodeKey(node.projectId, node.path)}
              type="button"
              data-testid="explorer-node"
              data-node-key={nodeKey(node.projectId, node.path)}
              data-path={displayPath}
              data-node-path={node.path}
              data-type={isDir ? 'dir' : 'file'}
              data-active={isActive ? 'true' : 'false'}
              data-project-id={node.projectId}
              className={[
                'flex w-full items-center gap-2 px-2 py-1 text-left',
                isActive ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-100',
              ].join(' ')}
              style={{ paddingLeft }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  name: displayLabel,
                  path: displayPath,
                });
              }}
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
              <span className="truncate">{displayLabel}</span>
            </button>
          );
        })}
        {contextMenu ? (
          <div
            className="fixed z-50 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              data-testid="explorer-copy-name"
              className="flex w-full items-center px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
              onClick={async () => {
                await copyToClipboard(contextMenu.name);
                setContextMenu(null);
              }}
            >
              Copy Name
            </button>
            <button
              type="button"
              data-testid="explorer-copy-path"
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100"
              onClick={async () => {
                await copyToClipboard(contextMenu.path);
                setContextMenu(null);
              }}
            >
              <span>Copy Path</span>
              <span className="text-xs text-gray-400">Alt+Shift+C</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
