import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import {
  type Edge as GraphEdge,
  type Graph,
  type HierarchyInfo,
  type Node as GraphNode,
  buildHierarchy,
  filterRedundantEdges,
  getPreservableNodeIds,
  alignToPreservedPositions,
  buildPreservedPositionsMap,
  splitMultiParentNodes,
} from '../graph';
import type { CodeFocus } from '../code_viewer';
import {
  adjustParentDimensions,
  layoutGraphWithDagre,
  layoutGraphWithElk,
  resizeSingleParent,
} from './graph_layout';
import { setupGraphTestApis } from '../testing/graph_test_utils';

// ── Types ──────────────────────────────────────────────────────────────

export type GraphNodeData = {
  label?: string;
  node: GraphNode;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
  revealDirectory: (objectId: string) => void;
  revealQueryRange?: (start: number, end: number) => void;
  isGroupNode?: boolean;
  hiddenRefEdges?: Array<GraphEdge>;
};

export type GraphEdgeData = {
  edges: Array<GraphEdge>;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
};

// ── Pure helpers ───────────────────────────────────────────────────────

const INITIAL_NODE_OFFSET = 40;

function applyLayoutPadding(
  nodes: FlowNode<GraphNodeData>[],
  padding: number,
) {
  if (nodes.length === 0) return nodes;
  const rootNodes = nodes.filter((n) => !(n as any).parentNode);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  rootNodes.forEach((node) => {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return nodes;
  const offsetX = Math.max(0, padding - minX);
  const offsetY = Math.max(0, padding - minY);
  if (offsetX === 0 && offsetY === 0) return nodes;
  return nodes.map((node) => {
    if ((node as any).parentNode) return node;
    return {
      ...node,
      position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
    };
  });
}

export function getNodeAbsolutePosition(node: FlowNode<GraphNodeData>): { x: number; y: number } {
  return (node as any).positionAbsolute ?? node.position;
}

export function getNodeSize(node: FlowNode<GraphNodeData>): { width: number; height: number } {
  return {
    width: node.width ?? (node as any).measured?.width ?? 0,
    height: node.height ?? (node as any).measured?.height ?? 0,
  };
}

function toAbsolutePosition(
  nodeId: string,
  hierarchy: HierarchyInfo,
  positions: Map<string, { x: number; y: number }>,
): { x: number; y: number } {
  let x = 0, y = 0;
  let current: string | undefined = nodeId;
  while (current) {
    const pos = positions.get(current);
    if (!pos) {
      const own = positions.get(nodeId);
      return own ? { ...own } : { x: 0, y: 0 };
    }
    x += pos.x;
    y += pos.y;
    current = hierarchy.childToParent.get(current);
  }
  return { x, y };
}

/**
 * Migrate positionsRef entries when the graph changes.
 * Handles:
 * 1. Converting child→standalone positions from relative to absolute
 * 2. Migrating split→unsplit and unsplit→split positions
 * 3. Pruning entries for nodes that no longer exist
 */
function migratePositionsForGraphChange(
  positions: Map<string, { x: number; y: number }>,
  oldHierarchy: HierarchyInfo,
  newGraph: Graph,
): void {
  const newHierarchy = buildHierarchy(newGraph.has_edges, newGraph.nodes);
  const newNodeIds = new Set(newGraph.nodes.keys());

  const posSnapshot = new Map(positions);
  positions.forEach((_pos, nodeId) => {
    const oldParent = oldHierarchy.childToParent.get(nodeId);
    const newParent = newHierarchy.childToParent.get(nodeId);
    if (oldParent && !newParent) {
      positions.set(nodeId, toAbsolutePosition(nodeId, oldHierarchy, posSnapshot));
    }
  });

  const oldSplitsByBase = new Map<string, { id: string; pos: { x: number; y: number } }[]>();
  positions.forEach((pos, id) => {
    const nulIdx = id.indexOf('\0');
    if (nulIdx !== -1) {
      const baseId = id.substring(0, nulIdx);
      let arr = oldSplitsByBase.get(baseId);
      if (!arr) { arr = []; oldSplitsByBase.set(baseId, arr); }
      arr.push({ id, pos });
    }
  });

  newNodeIds.forEach((nodeId) => {
    if (positions.has(nodeId)) return;
    if (nodeId.indexOf('\0') !== -1) return;
    const oldSplits = oldSplitsByBase.get(nodeId);
    if (oldSplits && oldSplits.length > 0) {
      const rootSplit = oldSplits.find(s => s.id.endsWith('\0root'));
      positions.set(nodeId, rootSplit ? rootSplit.pos : oldSplits[0].pos);
    }
  });

  newNodeIds.forEach((nodeId) => {
    if (positions.has(nodeId)) return;
    const nulIdx = nodeId.indexOf('\0');
    if (nulIdx === -1) return;
    const baseId = nodeId.substring(0, nulIdx);
    const oldPos = positions.get(baseId);
    if (oldPos && !newHierarchy.childToParent.has(nodeId)) {
      positions.set(nodeId, { ...oldPos });
    }
  });

  positions.forEach((_pos, id) => {
    if (!newNodeIds.has(id)) positions.delete(id);
  });
}

function hasNodeOverlap(previous: Graph | null, next: Graph) {
  if (!previous || previous.nodes.size === 0 || next.nodes.size === 0) return false;
  for (const nodeId of Array.from(next.nodes.keys())) {
    if (previous.nodes.has(nodeId)) return true;
  }
  return false;
}

function splitSymbolWithOffsets(label: string): { tokens: string[]; offsets: number[] } {
  const tokens: string[] = [];
  const offsets: number[] = [];
  const re = /[^/]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label)) !== null) {
    tokens.push(m[0]);
    offsets.push(m.index);
  }
  return { tokens, offsets };
}

function buildDisplayLabelMap(graph: Graph) {
  const entries = Array.from(graph.nodes.values()).map((node) => {
    const { tokens, offsets } = splitSymbolWithOffsets(node.label);
    return { id: node.id, label: node.label, tokens, offsets };
  });
  const seen = new Set<string>();
  const uniqueEntries = entries.filter(({ label }) => {
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });

  const suffixCounts = new Map<string, number>();
  uniqueEntries.forEach(({ tokens, label }) => {
    if (tokens.length === 0) {
      suffixCounts.set(label, (suffixCounts.get(label) ?? 0) + 1);
      return;
    }
    for (let start = tokens.length - 1; start >= 0; start -= 1) {
      const suffix = tokens.slice(start).join('\0');
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  });

  const displayMap = new Map<string, string>();
  entries.forEach(({ id, label, tokens, offsets }) => {
    if (tokens.length === 0) {
      displayMap.set(id, label);
      return;
    }
    let resolved = label;
    for (let len = 1; len <= tokens.length; len += 1) {
      const suffix = tokens.slice(tokens.length - len).join('\0');
      if ((suffixCounts.get(suffix) ?? 0) === 1) {
        resolved = label.substring(offsets[tokens.length - len]);
        break;
      }
    }
    displayMap.set(id, resolved);
  });

  return displayMap;
}

export function parentDepth(nodeId: string, hierarchy: HierarchyInfo): number {
  let depth = 0;
  let cur = hierarchy.childToParent.get(nodeId);
  while (cur) { depth++; cur = hierarchy.childToParent.get(cur); }
  return depth;
}

export function resizeParentsForNodes(
  draggedNodeIds: string[],
  currentNodes: FlowNode<GraphNodeData>[],
  hierarchy: HierarchyInfo,
): FlowNode<GraphNodeData>[] {
  const nodes = currentNodes.map((n) => ({ ...n, position: { ...n.position } }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const affectedParentIds = new Set<string>();
  for (const nodeId of draggedNodeIds) {
    let pid = hierarchy.childToParent.get(nodeId);
    while (pid) {
      affectedParentIds.add(pid);
      pid = hierarchy.childToParent.get(pid);
    }
  }
  if (affectedParentIds.size === 0) return nodes;

  const sorted = Array.from(affectedParentIds).sort((a, b) =>
    parentDepth(b, hierarchy) - parentDepth(a, hierarchy),
  );

  for (const pid of sorted) {
    const parent = nodeMap.get(pid);
    if (!parent) continue;
    const childIds = hierarchy.parentToChildren.get(pid);
    if (!childIds || childIds.size === 0) continue;
    const children: FlowNode<GraphNodeData>[] = [];
    childIds.forEach((childId) => {
      const child = nodeMap.get(childId);
      if (child) children.push(child);
    });
    if (children.length > 0) resizeSingleParent(parent, children);
  }

  return nodes;
}

// ── Hook ───────────────────────────────────────────────────────────────

interface UseGraphLayoutOptions {
  graph: Graph;
  selectFile: (codeFocus: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  revealDirectory: (objectId: string) => void;
  revealQueryRange?: (start: number, end: number) => void;
}

export function useGraphLayout({
  graph,
  selectFile,
  fileContents,
  ensureFileContent,
  revealDirectory,
  revealQueryRange,
}: UseGraphLayoutOptions) {
  const [nodes, setNodes] = useNodesState<GraphNodeData>([]);
  const [edges, setEdges] = useEdgesState<GraphEdgeData>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hierarchyRef = useRef<HierarchyInfo>({ childToParent: new Map(), parentToChildren: new Map() });
  const nodesRef = useRef<FlowNode<GraphNodeData>[]>([]);
  const graphRef = useRef<Graph | null>(null);
  const layoutRunIdRef = useRef(0);
  const [layoutGen, setLayoutGen] = useState(0);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  const splitGraph = useMemo(() => splitMultiParentNodes(graph), [graph]);
  const displayLabels = useMemo(() => buildDisplayLabelMap(splitGraph), [splitGraph]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof applyNodeChanges>[0]) => {
      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(changes, currentNodes);
        changes.forEach((change) => {
          if (change.type === 'position' && change.position) {
            positionsRef.current.set(change.id, change.position);
          }
          if (change.type === 'remove') {
            positionsRef.current.delete(change.id);
          }
        });
        return nextNodes;
      });
    },
    [setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof applyEdgeChanges>[0]) => {
      setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
    },
    [setEdges],
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const focusNode = useCallback(
    (nodeId: string) => {
      const targetNode = nodesRef.current.find((node) => node.id === nodeId);
      if (!targetNode) return;
      const { width, height } = getNodeSize(targetNode);
      const pos = getNodeAbsolutePosition(targetNode);
      const centerX = pos.x + width / 2;
      const centerY = pos.y + height / 2;
      const currentZoom = reactFlowInstanceRef.current?.getViewport().zoom ?? 1;
      reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: currentZoom });
    },
    [],
  );

  const buildFlowElements = useCallback(() => {
    const nextNodes: FlowNode<GraphNodeData>[] = [];
    const nextEdges: FlowEdge<GraphEdgeData>[] = [];

    const hierarchy = buildHierarchy(splitGraph.has_edges, splitGraph.nodes);
    const { childToParent, parentToChildren } = hierarchy;

    const { visible: filteredEdges, hiddenByHas } = filterRedundantEdges(splitGraph.edges, parentToChildren, splitGraph.nodes);

    const existingNodeMap = new Map(
      nodesRef.current.map((n) => [n.id, n]),
    );

    splitGraph.nodes.forEach((node) => {
      const position = positionsRef.current.get(node.id) ?? { x: 0, y: 0 };
      const isGroup = parentToChildren.has(node.id);
      const parentId = childToParent.get(node.id);
      const existing = existingNodeMap.get(node.id);
      const flowNode: FlowNode<GraphNodeData> = {
        id: node.id,
        type: 'graphNode',
        position,
        ...(isGroup && existing?.style ? { style: existing.style } : {}),
        ...(existing?.selected != null ? { selected: existing.selected } : {}),
        data: {
          label: displayLabels.get(node.id),
          node,
          graph: splitGraph,
          fileContents,
          ensureFileContent,
          selectFile,
          focusNode,
          revealDirectory,
          revealQueryRange,
          isGroupNode: isGroup,
          hiddenRefEdges: hiddenByHas.get(node.id),
        },
      };
      if (parentId) {
        (flowNode as any).parentNode = parentId;
      }
      nextNodes.push(flowNode);
    });

    const depthCache = new Map<string, number>();
    function getDepth(nodeId: string): number {
      if (depthCache.has(nodeId)) return depthCache.get(nodeId)!;
      const parent = childToParent.get(nodeId);
      const depth = parent ? getDepth(parent) + 1 : 0;
      depthCache.set(nodeId, depth);
      return depth;
    }
    nextNodes.sort((a, b) => getDepth(a.id) - getDepth(b.id));

    filteredEdges.forEach((edgeArray, edgeId) => {
      const edge = edgeArray[0]!;
      const isSelfLoop = edge.from === edge.to;
      nextEdges.push({
        id: edgeId,
        type: 'graphEdge',
        source: edge.from,
        target: edge.to,
        sourceHandle: isSelfLoop ? 'source-right' : 'source-bottom',
        targetHandle: isSelfLoop ? 'target-top-right' : 'target-top',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--graph-edge-color)',
          width: 10,
          height: 10,
          strokeWidth: 1,
          markerUnits: 'strokeWidth',
          orient: 'auto',
        },
        style: { stroke: 'var(--graph-edge-color)', strokeWidth: 3 },
        data: {
          edges: edgeArray,
          graph: splitGraph,
          fileContents,
          ensureFileContent,
          selectFile,
        },
      });
    });

    return { nextNodes, nextEdges, hierarchy };
  }, [splitGraph, displayLabels, fileContents, ensureFileContent, selectFile, focusNode, revealDirectory, revealQueryRange]);

  // ── Main layout effect ─────────────────────────────────────────────

  useEffect(() => {
    if (graphRef.current !== splitGraph) {
      migratePositionsForGraphChange(
        positionsRef.current,
        hierarchyRef.current,
        splitGraph,
      );
    }

    const { nextNodes, nextEdges, hierarchy } = buildFlowElements();
    setEdges(nextEdges);
    setNodes(nextNodes);

    if (nextNodes.length === 0) {
      positionsRef.current = new Map();
      hierarchyRef.current = hierarchy;
      return;
    }

    const graphChanged = graphRef.current !== splitGraph;
    const hasHierarchy = hierarchy.childToParent.size > 0;
    const shouldUseDagre = !hasHierarchy && !hasNodeOverlap(graphRef.current, splitGraph);
    graphRef.current = splitGraph;

    if (!graphChanged) {
      hierarchyRef.current = hierarchy;
      return;
    }

    const layoutRunId = ++layoutRunIdRef.current;
    const shouldApplyInitialPadding = positionsRef.current.size === 0;
    const positionsSnapshot = new Map(positionsRef.current);

    let preserveExisting: boolean;
    let layoutPositions: Map<string, { x: number; y: number }>;

    const hierarchyPreservedPositions =
      hasHierarchy && !shouldUseDagre && positionsRef.current.size > 0
        ? buildPreservedPositionsMap(
            getPreservableNodeIds(hierarchyRef.current, hierarchy, positionsRef.current),
            positionsRef.current,
          )
        : new Map<string, { x: number; y: number }>();

    if (hasHierarchy && !shouldUseDagre && positionsRef.current.size > 0) {
      const oldH = hierarchyRef.current;
      positionsRef.current.forEach((pos, nodeId) => {
        if (oldH.childToParent.has(nodeId) && !hierarchy.childToParent.has(nodeId)) {
          hierarchyPreservedPositions.set(nodeId, pos);
        }
      });
    }

    if (hierarchyPreservedPositions.size > 0) {
      const ensureAncestorsPreserved = (nodeId: string) => {
        const parentId = hierarchy.childToParent.get(nodeId);
        if (!parentId || hierarchyPreservedPositions.has(parentId)) return;
        const pos = positionsRef.current.get(parentId);
        if (pos) {
          hierarchyPreservedPositions.set(parentId, pos);
          ensureAncestorsPreserved(parentId);
        }
      };
      Array.from(hierarchyPreservedPositions.keys()).forEach(ensureAncestorsPreserved);
    }

    if (shouldUseDagre || positionsRef.current.size === 0 || hasHierarchy) {
      preserveExisting = false;
      layoutPositions = new Map();
    } else {
      preserveExisting = true;
      layoutPositions = new Map(positionsRef.current);
    }

    hierarchyRef.current = hierarchy;

    const shouldFitView = shouldUseDagre || (!preserveExisting && hierarchyPreservedPositions.size === 0);
    const layoutPromise = shouldUseDagre
      ? layoutGraphWithDagre(nextNodes, nextEdges)
      : layoutGraphWithElk(nextNodes, nextEdges, {
          preserveExisting,
          positions: layoutPositions,
          incremental: preserveExisting,
          hierarchy: hasHierarchy ? hierarchy : undefined,
        });

    layoutPromise.then((layoutedNodes) => {
      if (layoutRunId !== layoutRunIdRef.current) return;

      const alignedNodes = hierarchyPreservedPositions.size > 0
        ? alignToPreservedPositions(layoutedNodes, hierarchyPreservedPositions, hierarchy)
        : layoutedNodes;

      const measuredSizes = new Map<string, { width: number; height: number }>();
      for (const n of nodesRef.current) {
        const w = (n as any).measured?.width ?? n.width;
        const h = (n as any).measured?.height ?? n.height;
        if (w != null && h != null) {
          measuredSizes.set(n.id, { width: w, height: h });
        }
      }

      const finalNodes = hierarchy.parentToChildren.size > 0
        ? adjustParentDimensions(alignedNodes, hierarchy, measuredSizes)
        : alignedNodes;

      const paddedNodes = shouldApplyInitialPadding
        ? applyLayoutPadding(finalNodes, INITIAL_NODE_OFFSET)
        : finalNodes;
      setNodes(paddedNodes);
      positionsRef.current = new Map(
        paddedNodes.map((node) => [node.id, node.position]),
      );
      setLayoutGen((g) => g + 1);
      if (shouldFitView) {
        requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
        });
      }
    }).catch((err) => {
      console.error('Graph layout failed:', err);
      if (layoutRunId !== layoutRunIdRef.current) return;
      positionsRef.current = positionsSnapshot;
      setNodes((current) =>
        current.map((n) => {
          const pos = positionsSnapshot.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }),
      );
      setLayoutGen((g) => g + 1);
    });
  }, [buildFlowElements, splitGraph, setEdges, setNodes]);

  // ── Test API setup ─────────────────────────────────────────────────

  useEffect(() => {
    const cleanup = setupGraphTestApis();
    return () => { cleanup?.(); };
  }, []);

  // ── Manual re-layout ───────────────────────────────────────────────

  const handleDagreLayout = useCallback(() => {
    if (nodes.length === 0) return;

    const layoutRunId = ++layoutRunIdRef.current;
    const hasHierarchy = splitGraph.has_edges.length > 0;
    const layoutPromise = hasHierarchy
      ? layoutGraphWithElk(nodes, edges, {
          hierarchy: buildHierarchy(splitGraph.has_edges, splitGraph.nodes),
        })
      : layoutGraphWithDagre(nodes, edges);
    layoutPromise.then((layoutedNodes) => {
      if (layoutRunId !== layoutRunIdRef.current) return;
      setNodes(layoutedNodes);
      positionsRef.current = new Map(
        layoutedNodes.map((node) => [node.id, node.position]),
      );
      requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
      });
    }).catch((err) => {
      console.error('Graph layout failed:', err);
    });
  }, [edges, splitGraph, nodes, setNodes]);

  return {
    nodes,
    edges,
    setNodes,
    handleNodesChange,
    handleEdgesChange,
    splitGraph,
    layoutGen,
    positionsRef,
    hierarchyRef,
    nodesRef,
    reactFlowInstanceRef,
    layoutRunIdRef,
    focusNode,
    handleDagreLayout,
  };
}
