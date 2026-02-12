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
import { layoutGraph } from './lib/graph_layout';
import { setupGraphTestApis } from './testing/graph_test_utils';

export interface GraphProps {
  graph: Graph;
  selectFile: (codeFocus: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (fileId: string) => void;
}

type GraphNodeData = {
  node: GraphNode;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (fileId: string) => void;
  selectFile: (codeFocus: CodeFocus) => void;
};

type GraphEdgeData = {
  edges: Array<GraphEdge>;
  graph: Graph;
  fileContents: Map<string, string>;
  ensureFileContent: (fileId: string) => void;
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

const nodeTypes = { graphNode: GraphNodeComponent };
const edgeTypes = { graphEdge: GraphEdgeComponent };

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

function resolveEdgeFileId(edge: GraphEdge, graph: Graph): string | null {
  if (edge.from_file) {
    return edge.from_file;
  }

  const node = graph.nodes.get(edge.from);
  return node?.declarations[0]?.file_id ?? null;
}

function GraphNodeComponent({ id, data }: GraphNodeProps) {
  const menuContext = useContext(MenuContext);
  const activeMenu = menuContext?.activeMenu ?? null;
  const setActiveMenu = menuContext?.setActiveMenu ?? (() => {});
  const { node, graph, fileContents, ensureFileContent, selectFile } = data;
  const isOpen = activeMenu?.kind === 'node' && activeMenu.id === id;
  const declarationCount = node.declarations.length;

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (declarationCount === 1) {
        const decl = node.declarations[0];
        selectFile({
          file_id: decl.file_id,
          start_offset: decl.start_offset,
          end_offset: decl.end_offset,
        });
        setActiveMenu(null);
        return;
      }

      if (declarationCount > 1) {
        if (isOpen) {
          setActiveMenu(null);
          return;
        }
        triggerContextMenu(event);
      }
    },
    [declarationCount, isOpen, node, selectFile, setActiveMenu],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setActiveMenu(open ? { kind: 'node', id } : null);
    },
    [id, setActiveMenu],
  );

  return (
    <ContextMenu.Root open={isOpen} onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>
        <div
          className="graph-node"
          data-testid={`graph-node-${id}`}
          onClick={handleClick}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <Handle type="target" position={Position.Top} />
          {node.label}
          <Handle type="source" position={Position.Bottom} />
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
  const setActiveMenu = menuContext?.setActiveMenu ?? (() => {});
  const edges = data.edges;
  const isOpen = activeMenu?.kind === 'edge' && activeMenu.id === id;
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGGElement>) => {
      if (edges.length === 0) {
        return;
      }

      if (edges.length === 1) {
        const edge = edges[0];
        const fileId = resolveEdgeFileId(edge, data.graph);
        if (!fileId) {
          return;
        }
        data.selectFile({
          file_id: fileId,
          start_offset: edge.from_offset_start,
          end_offset: edge.from_offset_end,
        });
        setActiveMenu(null);
        return;
      }

      if (isOpen) {
        setActiveMenu(null);
        return;
      }

      triggerContextMenu(event);
    },
    [data, edges, isOpen, setActiveMenu],
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setActiveMenu(open ? { kind: 'edge', id } : null);
    },
    [id, setActiveMenu],
  );

  return (
    <ContextMenu.Root open={isOpen} onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger asChild>
        <g
          data-testid={`graph-edge-${id}`}
          onClick={handleClick}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <path
            d={edgePath}
            className="react-flow__edge-path"
            markerEnd={markerEnd}
            style={style}
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
            edges={edges}
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
  const graphRef = useRef<Graph | null>(null);
  const layoutRunIdRef = useRef(0);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const menuContextValue = useMemo(
    () => ({ activeMenu, setActiveMenu }),
    [activeMenu],
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

  const buildFlowElements = useCallback(() => {
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
          node,
          graph,
          fileContents,
          ensureFileContent,
          selectFile,
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
      nextEdges.push({
        id: edgeId,
        type: 'graphEdge',
        source: edge.from,
        target: edge.to,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9dbaea' },
        style: { stroke: '#9dbaea', strokeWidth: 3 },
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
  }, [graph, fileContents, ensureFileContent, selectFile]);

  useEffect(() => {
    const { nextNodes, nextEdges } = buildFlowElements();
    setEdges(nextEdges);
    setNodes(nextNodes);

    if (nextNodes.length === 0) {
      positionsRef.current = new Map();
      setActiveMenu(null);
      return;
    }

    const graphChanged = graphRef.current !== graph;
    graphRef.current = graph;

    if (!graphChanged) {
      return;
    }

    const layoutRunId = ++layoutRunIdRef.current;
    const preserveExisting = positionsRef.current.size > 0;
    const shouldFitView = !preserveExisting;

    layoutGraph(nextNodes, nextEdges, {
      preserveExisting,
      positions: positionsRef.current,
    }).then((layoutedNodes) => {
      if (layoutRunId !== layoutRunIdRef.current) {
        return;
      }
      setNodes(layoutedNodes);
      positionsRef.current = new Map(
        layoutedNodes.map((node) => [node.id, node.position]),
      );
      if (shouldFitView) {
        requestAnimationFrame(() => {
          reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
        });
      }
    });
  }, [buildFlowElements, graph, setActiveMenu, setEdges, setNodes]);

  useEffect(() => {
    const cleanup = setupGraphTestApis();
    return () => {
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!activeMenu) {
      return;
    }
    if (activeMenu.kind === 'node' && !graph.nodes.has(activeMenu.id)) {
      setActiveMenu(null);
    }
    if (activeMenu.kind === 'edge' && !graph.edges.has(activeMenu.id)) {
      setActiveMenu(null);
    }
  }, [activeMenu, graph]);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
  }, []);

  const handleRerunLayout = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }

    const layoutRunId = ++layoutRunIdRef.current;
    layoutGraph(nodes, edges, {
      preserveExisting: false,
      positions: new Map(),
    }).then((layoutedNodes) => {
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
        onRerunLayout={handleRerunLayout}
        onCenterGraph={handleCenterGraph}
        onFitToView={handleFitToView}
        onResetZoom={handleResetZoom}
      />
      <div className="flex-1">
        <MenuContext.Provider value={menuContextValue}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onInit={handleInit}
            onPaneClick={() => setActiveMenu(null)}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setActiveMenu(null);
            }}
            onNodeDragStart={() => setActiveMenu(null)}
            onlyRenderVisibleElements
            nodesDraggable
            panOnDrag={[0, 1]}
            nodesConnectable={false}
          >
            <Background gap={20} color="#d4d8e1" />
          </ReactFlow>
        </MenuContext.Provider>
      </div>
    </div>
  );
}
