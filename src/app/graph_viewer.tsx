import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getNodesBounds,
  Handle,
  MarkerType,
  Position,
  type Edge as FlowEdge,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Edge as GraphEdge, Graph, type HierarchyInfo, Node as GraphNode, SymbolInstance, buildHierarchy, filterRedundantEdges, getPreservableNodeIds, alignToPreservedPositions, buildPreservedPositionsMap, splitMultiParentNodes, isDirectoryInstance, isSelfReference } from './graph';
import { EdgesHover, NodeHover } from './node_hover';
import { CodeFocus } from './code_viewer';
import { GraphToolbar } from './graph_toolbar';
import { adjustParentDimensions, resizeSingleParent, layoutGraphWithDagre, layoutGraphWithElk, resolveNodeSize } from './lib/graph_layout';
import { parseOffset } from './lib/offsets';
import { setupGraphTestApis } from './testing/graph_test_utils';

export interface GraphProps {
  graph: Graph;
  selectFile: (codeFocus: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  revealDirectory: (objectId: string) => void;
}

type GraphNodeData = {
  label?: string;
  node: GraphNode;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
  revealDirectory: (objectId: string) => void;
  isGroupNode?: boolean;
  hiddenRefEdges?: Array<GraphEdge>;
};

type GraphEdgeData = {
  edges: Array<GraphEdge>;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
};

type ActiveMenu = { kind: 'node' | 'edge'; id: string } | null;

type GraphNodeProps = NodeProps<GraphNodeData>;
type GraphEdgeProps = EdgeProps<GraphEdgeData>;

type MenuContextValue = {
  activeMenu: ActiveMenu;
  setActiveMenu: (menu: ActiveMenu) => void;
};

const MenuContext = React.createContext<MenuContextValue | null>(null);

type SelectionContextValue = {
  lastSelected: { kind: 'node' | 'edge'; id: string } | null;
  setLastSelected: (selection: { kind: 'node' | 'edge'; id: string } | null) => void;
};

const SelectionContext = React.createContext<SelectionContextValue | null>(null);

const INITIAL_NODE_OFFSET = 40;

function applyLayoutPadding(
  nodes: FlowNode<GraphNodeData>[],
  padding: number,
) {
  if (nodes.length === 0) {
    return nodes;
  }
  // Only consider root-level nodes (no parent) for min computation
  const rootNodes = nodes.filter((n) => !(n as any).parentNode);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  rootNodes.forEach((node) => {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return nodes;
  }
  const offsetX = Math.max(0, padding - minX);
  const offsetY = Math.max(0, padding - minY);
  if (offsetX === 0 && offsetY === 0) {
    return nodes;
  }
  // Only shift root-level nodes; child positions are relative to parent
  return nodes.map((node) => {
    if ((node as any).parentNode) return node;
    return {
      ...node,
      position: {
        x: node.position.x + offsetX,
        y: node.position.y + offsetY,
      },
    };
  });
}

function getNodeAbsolutePosition(node: FlowNode<GraphNodeData>): { x: number; y: number } {
  return (node as any).positionAbsolute ?? node.position;
}

function getNodeSize(node: FlowNode<GraphNodeData>): { width: number; height: number } {
  return {
    width: node.width ?? (node as any).measured?.width ?? 0,
    height: node.height ?? (node as any).measured?.height ?? 0,
  };
}

function dismissContextMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function triggerContextMenu(event: React.MouseEvent<Element>) {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const clientX = event.clientX || rect.left + rect.width / 2;
  const clientY = event.clientY || rect.top + rect.height / 2;
  const contextEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    clientX,
    clientY,
  });
  target.dispatchEvent(contextEvent);
}

function parseRgbChannel(value: string) {
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value);
    return Number.isNaN(percent) ? null : Math.round((percent / 100) * 255);
  }
  const numberValue = Number.parseFloat(value);
  return Number.isNaN(numberValue) ? null : Math.round(numberValue);
}

function parseColorToRgba(color: string) {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    const normalize = (value: string) => Number.parseInt(value, 16);
    if (hex.length === 3) {
      const r = normalize(hex[0] + hex[0]);
      const g = normalize(hex[1] + hex[1]);
      const b = normalize(hex[2] + hex[2]);
      return { r, g, b, a: 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = normalize(hex.slice(0, 2));
      const g = normalize(hex.slice(2, 4));
      const b = normalize(hex.slice(4, 6));
      const a =
        hex.length === 8 ? normalize(hex.slice(6, 8)) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  if (trimmed.startsWith('rgb')) {
    const match = trimmed.match(/rgba?\(([^)]+)\)/);
    if (!match) {
      return null;
    }
    const parts = match[1].split(',').map((part) => part.trim());
    if (parts.length < 3) {
      return null;
    }
    const r = parseRgbChannel(parts[0]);
    const g = parseRgbChannel(parts[1]);
    const b = parseRgbChannel(parts[2]);
    if (r === null || g === null || b === null) {
      return null;
    }
    const a = parts[3] ? Number.parseFloat(parts[3]) : 1;
    return { r, g, b, a: Number.isNaN(a) ? 1 : a };
  }

  return null;
}

function darkenColor(color: string, amount: number) {
  const parsed = parseColorToRgba(color);
  if (!parsed) {
    return color;
  }
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const darkenChannel = (value: number) => clamp(Math.round(value * (1 - amount)));
  const r = darkenChannel(parsed.r);
  const g = darkenChannel(parsed.g);
  const b = darkenChannel(parsed.b);
  if (parsed.a < 1) {
    return `rgba(${r}, ${g}, ${b}, ${parsed.a.toFixed(3)})`;
  }
  return `rgb(${r}, ${g}, ${b})`;
}

// Split label into tokens for dedup, and record each token's start offset
// in the original label so we can slice the original string for display.
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
  // Deduplicate by label so split nodes with identical names don't
  // inflate suffix counts and prevent shortening.
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
        // Slice from the original label at the start of the first matched token
        resolved = label.substring(offsets[tokens.length - len]);
        break;
      }
    }
    displayMap.set(id, resolved);
  });

  return displayMap;
}

function resolveEdgeObjectId(edge: GraphEdge, graph: Graph): string | null {
  if (edge.from_object) {
    return edge.from_object;
  }

  const node = graph.nodes.get(edge.from);
  return node?.symbol_instances[0]?.object_id ?? null;
}

function hasNodeOverlap(previous: Graph | null, next: Graph) {
  if (!previous || previous.nodes.size === 0 || next.nodes.size === 0) {
    return false;
  }
  for (const nodeId of Array.from(next.nodes.keys())) {
    if (previous.nodes.has(nodeId)) {
      return true;
    }
  }
  return false;
}

function GraphNodeComponent({ id, data }: GraphNodeProps) {
  const menuContext = useContext(MenuContext);
  const activeMenu = menuContext?.activeMenu ?? null;
  const setActiveMenu = menuContext?.setActiveMenu;
  const selectionContext = useContext(SelectionContext);
  const lastSelected = selectionContext?.lastSelected ?? null;
  const setLastSelected = selectionContext?.setLastSelected;
  const { node, graph, fileContents, ensureFileContent, selectFile, isGroupNode, revealDirectory, hiddenRefEdges } = data;
  const displayLabel = data.label ?? node.label;
  const nodeStyle = node.color
    ? ({ '--graph-node-color': node.color } as React.CSSProperties)
    : undefined;
  const isOpen = activeMenu?.kind === 'node' && activeMenu.id === id;
  const isSelected = lastSelected?.kind === 'node' && lastSelected.id === id;
  const instanceCount = node.symbol_instances.length;
  const isDirectoryNode = isGroupNode || node.symbol_instances.every((inst) => isDirectoryInstance(inst));

  const hasHiddenRefs = (hiddenRefEdges?.length ?? 0) > 0;

  const closeMenu = useCallback(() => dismissContextMenu(), []);

  const wrappedSelectFile = useCallback(
    (codeFocus: CodeFocus) => {
      selectFile(codeFocus);
      closeMenu();
    },
    [selectFile, closeMenu],
  );

  const wrappedFocusNode = useCallback(
    (nodeId: string) => {
      data.focusNode(nodeId);
      closeMenu();
    },
    [data.focusNode, closeMenu],
  );

  const wrappedRevealDirectory = useCallback(
    (objectId: string) => {
      revealDirectory(objectId);
      closeMenu();
    },
    [revealDirectory, closeMenu],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setLastSelected?.({ kind: 'node', id });

      if (isDirectoryNode) {
        const realInstances = node.symbol_instances.filter((inst) => !isDirectoryInstance(inst));
        if (realInstances.length === 1 && !hasHiddenRefs) {
          const inst = realInstances[0];
          selectFile({
            object_id: inst.object_id,
            start_offset: inst.start_offset,
            end_offset: inst.end_offset,
          });
          setActiveMenu?.(null);
          return;
        }
        if (realInstances.length > 1 || hasHiddenRefs) {
          if (isOpen) {
            setActiveMenu?.(null);
            return;
          }
          triggerContextMenu(event);
          return;
        }
        // Only directory instances — reveal directory in tree
        const selfRef = node.symbol_instances.find((inst) => isSelfReference(inst)) ?? node.symbol_instances[0];
        if (selfRef) {
          revealDirectory(selfRef.object_id);
        }
        setActiveMenu?.(null);
        return;
      }

      if (instanceCount === 1 && !hasHiddenRefs) {
        const inst = node.symbol_instances[0];
        selectFile({
          object_id: inst.object_id,
          start_offset: inst.start_offset,
          end_offset: inst.end_offset,
        });
        setActiveMenu?.(null);
        return;
      }

      if (instanceCount > 1 || hasHiddenRefs) {
        if (isOpen) {
          setActiveMenu?.(null);
          return;
        }
        triggerContextMenu(event);
      }
    },
    [instanceCount, id, isDirectoryNode, isOpen, hasHiddenRefs, node, revealDirectory, selectFile, setActiveMenu, setLastSelected],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setActiveMenu?.(open ? { kind: 'node', id } : null);
    },
    [id, setActiveMenu],
  );

  return (
    <ContextMenu.Root onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>
        <div
          className={isGroupNode
            ? `graph-group-node${isSelected ? ' graph-group-node-selected' : ''}`
            : `graph-node${isSelected ? ' graph-node-selected' : ''}`}
          data-testid={`graph-node-${id}`}
          style={isGroupNode ? { width: '100%', height: '100%' } : nodeStyle}
          title={node.label}
          onClick={handleClick}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <Handle id="target-top" type="target" position={Position.Top} />
          {isGroupNode
            ? <div className="graph-group-node-header">{displayLabel}</div>
            : displayLabel}
          <Handle id="source-bottom" type="source" position={Position.Bottom} />
          <Handle
            id="target-top-right"
            type="target"
            position={Position.Top}
            className="graph-handle-hidden"
            style={{ left: '75%' }}
          />
          <Handle
            id="source-right"
            type="source"
            position={Position.Right}
            className="graph-handle-hidden"
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="context-menu-content"
          data-testid={`context-menu-node-${id}`}
        >
          <NodeHover
            node={node}
            graph={graph}
            setCodeFocus={wrappedSelectFile}
            focusNode={wrappedFocusNode}
            fileContents={fileContents}
            ensureFileContent={ensureFileContent}
            isGroupNode={isDirectoryNode}
            revealDirectory={wrappedRevealDirectory}
            hiddenRefEdges={hiddenRefEdges}
            onAction={closeMenu}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function GraphEdgeComponent({
  id,
  data,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: GraphEdgeProps) {
  const menuContext = useContext(MenuContext);
  const activeMenu = menuContext?.activeMenu ?? null;
  const setActiveMenu = menuContext?.setActiveMenu;
  const selectionContext = useContext(SelectionContext);
  const lastSelected = selectionContext?.lastSelected ?? null;
  const setLastSelected = selectionContext?.setLastSelected;
  const edges = data?.edges;
  const edgesList = useMemo(() => edges ?? [], [edges]);
  const graph = data?.graph;
  const selectFile = data?.selectFile;
  const isOpen = activeMenu?.kind === 'edge' && activeMenu.id === id;
  const isSelected = lastSelected?.kind === 'edge' && lastSelected.id === id;
  const isSelfLoop = source === target;

  const closeMenu = useCallback(() => dismissContextMenu(), []);

  const wrappedSelectFile = useCallback(
    (codeFocus: CodeFocus) => {
      selectFile?.(codeFocus);
      closeMenu();
    },
    [selectFile, closeMenu],
  );

  let edgePath = '';
  const edgeBaseColor =
    typeof style?.stroke === 'string'
      ? style.stroke
      : 'var(--graph-edge-color)';
  const selectedEdgeColor = edgeBaseColor.startsWith('var(')
    ? 'var(--graph-edge-color-selected)'
    : darkenColor(edgeBaseColor, 0.35);
  const baseStrokeWidth =
    typeof style?.strokeWidth === 'number' ? style.strokeWidth : 3;
  const edgeStyle = isSelected
    ? {
        ...(style ?? {}),
        stroke: selectedEdgeColor,
        strokeWidth: baseStrokeWidth + 1,
        filter: 'drop-shadow(0 2px 4px rgba(15, 23, 42, 0.2))',
      }
    : style;

  if (isSelfLoop) {
    const loopOffsetX = 70;
    const loopOffsetY = 50;
    const control1X = sourceX + loopOffsetX;
    const control1Y = sourceY - loopOffsetY;
    const control2X = targetX;
    const control2Y = targetY - loopOffsetY;
    edgePath = `M ${sourceX} ${sourceY}
      C ${control1X} ${control1Y} ${control2X} ${control2Y} ${targetX} ${targetY}`;
  } else {
    const entryOffset = 12;
    const targetDir = (() => {
      switch (targetPosition) {
        case Position.Left:
          return { x: -1, y: 0 };
        case Position.Right:
          return { x: 1, y: 0 };
        case Position.Bottom:
          return { x: 0, y: 1 };
        case Position.Top:
        default:
          return { x: 0, y: -1 };
      }
    })();
    const preTargetX = targetX + targetDir.x * entryOffset;
    const preTargetY = targetY + targetDir.y * entryOffset;
    const [curvePath] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX: preTargetX,
      targetY: preTargetY,
      targetPosition,
    });
    edgePath = `${curvePath} L ${targetX},${targetY}`;
  }

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      setLastSelected?.({ kind: 'edge', id });
      if (edgesList.length === 0) {
        return;
      }

      if (edgesList.length === 1) {
        const edge = edgesList[0];
        if (!graph || !selectFile) {
          return;
        }
        const objectId = resolveEdgeObjectId(edge, graph);
        if (!objectId) {
          return;
        }
        selectFile({
          object_id: objectId,
          start_offset: edge.from_offset_start,
          end_offset: edge.from_offset_end,
        });
        setActiveMenu?.(null);
        return;
      }

      if (isOpen) {
        setActiveMenu?.(null);
        return;
      }

      triggerContextMenu(event);
    },
    [edgesList, graph, id, isOpen, selectFile, setActiveMenu, setLastSelected],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setActiveMenu?.(open ? { kind: 'edge', id } : null);
    },
    [id, setActiveMenu],
  );

  if (!data) {
    return null;
  }

  return (
    <ContextMenu.Root onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>
        <g
          className={`graph-edge${isSelected ? ' graph-edge-selected' : ''}`}
          data-testid={`graph-edge-${id}`}
          onClick={handleClick}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <path
            d={edgePath}
            className="react-flow__edge-path"
            markerEnd={markerEnd}
            style={edgeStyle}
          />
          <path d={edgePath} className="graph-edge-hit" />
        </g>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="context-menu-content"
          data-testid={`context-menu-edge-${id}`}
        >
          <EdgesHover
            edges={edgesList}
            graph={data.graph}
            setCodeFocus={wrappedSelectFile}
            fileContents={data.fileContents}
            ensureFileContent={data.ensureFileContent}
            onAction={closeMenu}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function resizeParentsForNode(
  draggedNodeId: string,
  currentNodes: FlowNode<GraphNodeData>[],
  hierarchy: HierarchyInfo,
): FlowNode<GraphNodeData>[] {
  const nodes = currentNodes.map((n) => ({ ...n, position: { ...n.position } }));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  let currentId: string | undefined = hierarchy.childToParent.get(draggedNodeId);

  while (currentId) {
    const parentNode = nodeMap.get(currentId);
    if (!parentNode) break;

    const childIdSet = hierarchy.parentToChildren.get(currentId);
    if (!childIdSet || childIdSet.size === 0) break;

    const children: FlowNode<GraphNodeData>[] = [];
    childIdSet.forEach((childId) => {
      const child = nodeMap.get(childId);
      if (child) children.push(child);
    });
    if (children.length === 0) break;

    if (!resizeSingleParent(parentNode, children)) break;

    currentId = hierarchy.childToParent.get(currentId);
  }

  return nodes;
}

export function GraphViewer({
  graph,
  selectFile,
  fileContents,
  ensureFileContent,
  revealDirectory,
}: GraphProps) {
  const nodeTypes = useMemo(() => ({ graphNode: GraphNodeComponent }), []);
  const edgeTypes = useMemo(() => ({ graphEdge: GraphEdgeComponent }), []);
  const [nodes, setNodes] = useNodesState<GraphNodeData>([]);
  const [edges, setEdges] = useEdgesState<GraphEdgeData>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hierarchyRef = useRef<HierarchyInfo>({ childToParent: new Map(), parentToChildren: new Map() });
  const nodesRef = useRef<FlowNode<GraphNodeData>[]>([]);
  const graphRef = useRef<Graph | null>(null);
  const layoutRunIdRef = useRef(0);
  const [layoutGen, setLayoutGen] = useState(0);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [lastSelected, setLastSelected] = useState<{
    kind: 'node' | 'edge';
    id: string;
  } | null>(null);
  const splitGraph = useMemo(() => splitMultiParentNodes(graph), [graph]);

  const resolvedActiveMenu = useMemo(() => {
    if (!activeMenu) {
      return null;
    }
    if (activeMenu.kind === 'node' && !splitGraph.nodes.has(activeMenu.id)) {
      return null;
    }
    if (activeMenu.kind === 'edge' && !splitGraph.edges.has(activeMenu.id)) {
      return null;
    }
    return activeMenu;
  }, [activeMenu, splitGraph]);

  const menuContextValue = useMemo(
    () => ({ activeMenu: resolvedActiveMenu, setActiveMenu }),
    [resolvedActiveMenu],
  );
  const selectionContextValue = useMemo(
    () => ({ lastSelected, setLastSelected }),
    [lastSelected],
  );

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
      if (!targetNode) {
        return;
      }
      const { width, height } = getNodeSize(targetNode);
      const pos = getNodeAbsolutePosition(targetNode);
      const centerX = pos.x + width / 2;
      const centerY = pos.y + height / 2;
      const currentZoom = reactFlowInstanceRef.current?.getViewport().zoom ?? 1;
      reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: currentZoom });
    },
    [],
  );

  const displayLabels = useMemo(() => buildDisplayLabelMap(splitGraph), [splitGraph]);

  const buildFlowElements = useCallback(() => {
    const nextNodes: FlowNode<GraphNodeData>[] = [];
    const nextEdges: FlowEdge<GraphEdgeData>[] = [];
    const nextNodeIds = new Set(splitGraph.nodes.keys());
    positionsRef.current.forEach((_pos, id) => {
      if (!nextNodeIds.has(id)) {
        positionsRef.current.delete(id);
      }
    });

    const hierarchy = buildHierarchy(splitGraph.has_edges, splitGraph.nodes);
    const { childToParent, parentToChildren } = hierarchy;

    const { visible: filteredEdges, hiddenByHas } = filterRedundantEdges(splitGraph.edges, parentToChildren, splitGraph.nodes);

    // Build a lookup of existing nodes to preserve layout-computed style (width/height on group nodes)
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
        // Preserve layout-computed style (width/height) on group nodes
        ...(isGroup && existing?.style ? { style: existing.style } : {}),
        data: {
          label: displayLabels.get(node.id),
          node,
          graph: splitGraph,
          fileContents,
          ensureFileContent,
          selectFile,
          focusNode,
          revealDirectory,
          isGroupNode: isGroup,
          hiddenRefEdges: hiddenByHas.get(node.id),
        },
      };
      if (parentId) {
        (flowNode as any).parentNode = parentId;
      }
      nextNodes.push(flowNode);
    });

    // Sort so parents come before children (ReactFlow requirement)
    const depthCache = new Map<string, number>();
    function getDepth(nodeId: string): number {
      if (depthCache.has(nodeId)) return depthCache.get(nodeId)!;
      const parent = childToParent.get(nodeId);
      const depth = parent ? getDepth(parent) + 1 : 0;
      depthCache.set(nodeId, depth);
      return depth;
    }
    nextNodes.sort((a, b) => getDepth(a.id) - getDepth(b.id));

    // filterRedundantEdges guarantees non-empty edgeArray with valid from/to nodes
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
  }, [splitGraph, displayLabels, fileContents, ensureFileContent, selectFile, focusNode, revealDirectory]);

  useEffect(() => {
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

    let preserveExisting: boolean;
    let layoutPositions: Map<string, { x: number; y: number }>;

    // When hierarchy is present, we can't use elk.fixed (causes overlaps).
    // Instead we run ELK fresh and post-process: translate the result to
    // align with preserved positions, then override preserved nodes.
    const hierarchyPreservedPositions =
      hasHierarchy && !shouldUseDagre && positionsRef.current.size > 0
        ? buildPreservedPositionsMap(
            getPreservableNodeIds(hierarchyRef.current, hierarchy, positionsRef.current),
            positionsRef.current,
          )
        : new Map<string, { x: number; y: number }>();

    if (shouldUseDagre || positionsRef.current.size === 0 || hasHierarchy) {
      preserveExisting = false;
      layoutPositions = new Map();
    } else {
      preserveExisting = true;
      layoutPositions = positionsRef.current;
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
      if (layoutRunId !== layoutRunIdRef.current) {
        return;
      }

      const alignedNodes = hierarchyPreservedPositions.size > 0
        ? alignToPreservedPositions(layoutedNodes, hierarchyPreservedPositions, hierarchy)
        : layoutedNodes;

      // Build measured sizes from previously rendered nodes so adjustParentDimensions
      // uses the same actual dimensions as resizeParentsForNode (drag handler).
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
    });
  }, [buildFlowElements, splitGraph, setEdges, setNodes]);

  useEffect(() => {
    const cleanup = setupGraphTestApis();
    return () => {
      cleanup?.();
    };
  }, []);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
  }, []);

  const handleDagreLayout = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }

    const layoutRunId = ++layoutRunIdRef.current;
    const hasHierarchy = splitGraph.has_edges.length > 0;
    const layoutPromise = hasHierarchy
      ? layoutGraphWithElk(nodes, edges, {
          hierarchy: buildHierarchy(splitGraph.has_edges, splitGraph.nodes),
        })
      : layoutGraphWithDagre(nodes, edges);
    layoutPromise.then((layoutedNodes) => {
      if (layoutRunId !== layoutRunIdRef.current) {
        return;
      }
      setNodes(layoutedNodes);
      positionsRef.current = new Map(
        layoutedNodes.map((node) => [node.id, node.position]),
      );
      requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
      });
    });
  }, [edges, splitGraph, nodes, setNodes]);

  const handleCenterGraph = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }
    const bounds = getNodesBounds(nodes);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const currentZoom =
      reactFlowInstanceRef.current?.getViewport().zoom ?? 1;
    reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: currentZoom });
  }, [nodes]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: FlowNode<GraphNodeData>) => {
      const hierarchy = hierarchyRef.current;
      if (!hierarchy.childToParent.has(draggedNode.id)) return;
      setNodes((currentNodes) => {
        const resized = resizeParentsForNode(draggedNode.id, currentNodes, hierarchy);
        positionsRef.current = new Map(resized.map((n) => [n.id, n.position]));
        return resized;
      });
    },
    [setNodes],
  );

  const handleFitToView = useCallback(() => {
    reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
  }, []);

  const handleResetZoom = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }
    const bounds = getNodesBounds(nodes);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: 1 });
  }, [nodes]);

  // Group node bodies have pointer-events: none so edges underneath stay clickable.
  // When a pane click/contextmenu falls inside a group, forward it to the group's
  // header element.  Reads only from refs — stable with empty deps.
  const forwardPaneEventToGroup = useCallback(
    (clientX: number, clientY: number, action: (header: HTMLElement) => void) => {
      setActiveMenu(null);
      const instance = reactFlowInstanceRef.current;
      if (!instance) return;
      const flowPos = instance.screenToFlowPosition({ x: clientX, y: clientY });
      // Find the innermost (deepest) group node containing the click point.
      let bestNode: FlowNode<GraphNodeData> | null = null;
      let bestDepth = -1;
      for (const node of nodesRef.current) {
        if (!node.data.isGroupNode) continue;
        const pos = getNodeAbsolutePosition(node);
        const { width, height } = getNodeSize(node);
        if (flowPos.x >= pos.x && flowPos.x <= pos.x + width &&
            flowPos.y >= pos.y && flowPos.y <= pos.y + height) {
          let depth = 0;
          let parentId = hierarchyRef.current.childToParent.get(node.id);
          while (parentId) {
            depth++;
            parentId = hierarchyRef.current.childToParent.get(parentId);
          }
          if (depth > bestDepth) {
            bestDepth = depth;
            bestNode = node;
          }
        }
      }
      if (!bestNode) return;
      const header = document.querySelector(
        `[data-testid="graph-node-${bestNode.id}"] .graph-group-node-header`,
      ) as HTMLElement | null;
      if (header) action(header);
    },
    [setActiveMenu],
  );

  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      forwardPaneEventToGroup(event.clientX, event.clientY, (header) => header.click());
    },
    [forwardPaneEventToGroup],
  );

  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      forwardPaneEventToGroup(event.clientX, event.clientY, (header) => {
        header.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: event.clientX,
          clientY: event.clientY,
        }));
      });
    },
    [forwardPaneEventToGroup],
  );

  const shouldExposeMetadata = process.env.NODE_ENV !== 'production';
  const shouldOnlyRenderVisibleElements =
    typeof navigator === 'undefined' ? true : !navigator.webdriver;

  return (
    <div className="flex flex-col h-full">
      {shouldExposeMetadata && (
        <div
          aria-hidden="true"
          data-testid="graph-metadata"
          data-node-count={splitGraph.nodes.size}
          data-layout-gen={layoutGen}
          style={{ display: 'none' }}
        />
      )}
      <GraphToolbar
        onDagreLayout={handleDagreLayout}
        onCenterGraph={handleCenterGraph}
        onFitToView={handleFitToView}
        onResetZoom={handleResetZoom}
      />
      <div className="flex-1">
        <MenuContext.Provider value={menuContextValue}>
          <SelectionContext.Provider value={selectionContextValue}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onInit={handleInit}
              minZoom={0.1}
              onPaneClick={handlePaneClick}
              onPaneContextMenu={handlePaneContextMenu}
              onNodeDragStart={() => setActiveMenu(null)}
              onNodeDragStop={handleNodeDragStop}
              onlyRenderVisibleElements={shouldOnlyRenderVisibleElements}
              nodesDraggable
              panOnDrag={[0, 1]}
              nodesConnectable={false}
            >
              <Background gap={20} color="var(--graph-grid-color)" />
            </ReactFlow>
          </SelectionContext.Provider>
        </MenuContext.Provider>
      </div>
    </div>
  );
}
