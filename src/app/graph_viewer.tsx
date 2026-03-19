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
import { Edge as GraphEdge, Graph, Node as GraphNode } from './graph';
import { EdgesHover, NodeHover } from './node_hover';
import { CodeFocus } from './code_viewer';
import { GraphToolbar } from './graph_toolbar';
import { layoutGraphWithDagre, layoutGraphWithElk } from './lib/graph_layout';
import { setupGraphTestApis } from './testing/graph_test_utils';

export interface GraphProps {
  graph: Graph;
  selectFile: (codeFocus: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
}

type GraphNodeData = {
  label?: string;
  node: GraphNode;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
  focusNode: (nodeId: string) => void;
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

const nodeTypes = { graphNode: GraphNodeComponent };
const edgeTypes = { graphEdge: GraphEdgeComponent };
const INITIAL_NODE_OFFSET = 40;

function applyLayoutPadding(
  nodes: FlowNode<GraphNodeData>[],
  padding: number,
) {
  if (nodes.length === 0) {
    return nodes;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  nodes.forEach((node) => {
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
  return nodes.map((node) => ({
    ...node,
    position: {
      x: node.position.x + offsetX,
      y: node.position.y + offsetY,
    },
  }));
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

function splitSymbolParts(label: string) {
  return label.split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

function buildDisplayLabelMap(graph: Graph) {
  const entries = Array.from(graph.nodes.values()).map((node) => ({
    id: node.id,
    label: node.label,
    parts: splitSymbolParts(node.label),
  }));
  const suffixCounts = new Map<string, number>();

  entries.forEach(({ parts, label }) => {
    if (parts.length === 0) {
      suffixCounts.set(label, (suffixCounts.get(label) ?? 0) + 1);
      return;
    }
    for (let start = parts.length - 1; start >= 0; start -= 1) {
      const suffix = parts.slice(start).join('.');
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  });

  const displayMap = new Map<string, string>();
  entries.forEach(({ id, label, parts }) => {
    if (parts.length === 0) {
      displayMap.set(id, label);
      return;
    }
    let resolved = label;
    for (let len = 1; len <= parts.length; len += 1) {
      const suffix = parts.slice(parts.length - len).join('.');
      if ((suffixCounts.get(suffix) ?? 0) === 1) {
        resolved = suffix;
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
  const { node, graph, fileContents, ensureFileContent, selectFile } = data;
  const displayLabel = data.label ?? node.label;
  const nodeStyle = node.color
    ? ({ '--graph-node-color': node.color } as React.CSSProperties)
    : undefined;
  const isOpen = activeMenu?.kind === 'node' && activeMenu.id === id;
  const isSelected = lastSelected?.kind === 'node' && lastSelected.id === id;
  const instanceCount = node.symbol_instances.length;

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setLastSelected?.({ kind: 'node', id });
      if (instanceCount === 1) {
        const inst = node.symbol_instances[0];
        selectFile({
          object_id: inst.object_id,
          start_offset: inst.start_offset,
          end_offset: inst.end_offset,
        });
        setActiveMenu?.(null);
        return;
      }

      if (instanceCount > 1) {
        if (isOpen) {
          setActiveMenu?.(null);
          return;
        }
        triggerContextMenu(event);
      }
    },
    [instanceCount, id, isOpen, node, selectFile, setActiveMenu, setLastSelected],
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
          className={`graph-node${isSelected ? ' graph-node-selected' : ''}`}
          data-testid={`graph-node-${id}`}
          style={nodeStyle}
          title={node.label}
          onClick={handleClick}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <Handle id="target-top" type="target" position={Position.Top} />
          {displayLabel}
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
            setCodeFocus={selectFile}
            focusNode={data.focusNode}
            fileContents={fileContents}
            ensureFileContent={ensureFileContent}
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
            setCodeFocus={data.selectFile}
            fileContents={data.fileContents}
            ensureFileContent={data.ensureFileContent}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function GraphViewer({
  graph,
  selectFile,
  fileContents,
  ensureFileContent,
}: GraphProps) {
  const [nodes, setNodes] = useNodesState<GraphNodeData>([]);
  const [edges, setEdges] = useEdgesState<GraphEdgeData>([]);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const nodesRef = useRef<FlowNode<GraphNodeData>[]>([]);
  const graphRef = useRef<Graph | null>(null);
  const layoutRunIdRef = useRef(0);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const [lastSelected, setLastSelected] = useState<{
    kind: 'node' | 'edge';
    id: string;
  } | null>(null);
  const resolvedActiveMenu = useMemo(() => {
    if (!activeMenu) {
      return null;
    }
    if (activeMenu.kind === 'node' && !graph.nodes.has(activeMenu.id)) {
      return null;
    }
    if (activeMenu.kind === 'edge' && !graph.edges.has(activeMenu.id)) {
      return null;
    }
    return activeMenu;
  }, [activeMenu, graph]);

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
      const width = targetNode.width ?? (targetNode as any).measured?.width ?? 0;
      const height = targetNode.height ?? (targetNode as any).measured?.height ?? 0;
      const centerX = targetNode.position.x + width / 2;
      const centerY = targetNode.position.y + height / 2;
      const currentZoom = reactFlowInstanceRef.current?.getViewport().zoom ?? 1;
      reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: currentZoom });
    },
    [],
  );

  const buildFlowElements = useCallback(() => {
    const displayLabels = buildDisplayLabelMap(graph);
    const nextNodes: FlowNode<GraphNodeData>[] = [];
    const nextEdges: FlowEdge<GraphEdgeData>[] = [];
    const nextNodeIds = new Set(graph.nodes.keys());
    positionsRef.current.forEach((_pos, id) => {
      if (!nextNodeIds.has(id)) {
        positionsRef.current.delete(id);
      }
    });

    graph.nodes.forEach((node) => {
      const position = positionsRef.current.get(node.id) ?? { x: 0, y: 0 };
      nextNodes.push({
        id: node.id,
        type: 'graphNode',
        position,
        data: {
          label: displayLabels.get(node.id),
          node,
          graph,
          fileContents,
          ensureFileContent,
          selectFile,
          focusNode,
        },
      });
    });

    graph.edges.forEach((edgeArray, edgeId) => {
      const edge = edgeArray[0];
      if (!edge) {
        return;
      }
      if (!graph.nodes.has(edge.from) || !graph.nodes.has(edge.to)) {
        return;
      }
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
          graph,
          fileContents,
          ensureFileContent,
          selectFile,
        },
      });
    });

    return { nextNodes, nextEdges };
  }, [graph, fileContents, ensureFileContent, selectFile, focusNode]);

  useEffect(() => {
    const { nextNodes, nextEdges } = buildFlowElements();
    setEdges(nextEdges);
    setNodes(nextNodes);

    if (nextNodes.length === 0) {
      positionsRef.current = new Map();
      return;
    }

    const graphChanged = graphRef.current !== graph;
    const shouldUseDagre = !hasNodeOverlap(graphRef.current, graph);
    graphRef.current = graph;

    if (!graphChanged) {
      return;
    }

    const layoutRunId = ++layoutRunIdRef.current;
    const shouldApplyInitialPadding = positionsRef.current.size === 0;
    const preserveExisting = !shouldUseDagre && positionsRef.current.size > 0;
    const shouldFitView = shouldUseDagre || !preserveExisting;
    const layoutPromise = shouldUseDagre
      ? layoutGraphWithDagre(nextNodes, nextEdges)
      : layoutGraphWithElk(nextNodes, nextEdges, {
          preserveExisting,
          positions: positionsRef.current,
          incremental: preserveExisting,
        });

    layoutPromise.then((layoutedNodes) => {
      if (layoutRunId !== layoutRunIdRef.current) {
        return;
      }
      const paddedNodes = shouldApplyInitialPadding
        ? applyLayoutPadding(layoutedNodes, INITIAL_NODE_OFFSET)
        : layoutedNodes;
      setNodes(paddedNodes);
      positionsRef.current = new Map(
        paddedNodes.map((node) => [node.id, node.position]),
      );
      if (shouldFitView) {
        requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
        });
      }
    });
  }, [buildFlowElements, graph, setEdges, setNodes]);

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
    layoutGraphWithDagre(nodes, edges).then((layoutedNodes) => {
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
  }, [edges, nodes, setNodes]);

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

  const shouldExposeMetadata = process.env.NODE_ENV !== 'production';
  const shouldOnlyRenderVisibleElements =
    typeof navigator === 'undefined' ? true : !navigator.webdriver;

  return (
    <div className="flex flex-col h-full">
      {shouldExposeMetadata && (
        <div
          aria-hidden="true"
          data-testid="graph-metadata"
          data-node-count={graph.nodes.size}
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
              onPaneClick={() => setActiveMenu(null)}
              onPaneContextMenu={(event) => {
                event.preventDefault();
                setActiveMenu(null);
              }}
              onNodeDragStart={() => setActiveMenu(null)}
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
