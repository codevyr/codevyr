import React, { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  SelectionMode,
  getBezierPath,
  getNodesBounds,
  Handle,
  Position,
  type EdgeProps,
  type Node as FlowNode,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { type Edge as GraphEdge, type Graph, type HierarchyInfo, type Node as GraphNode, isDirectoryInstance, isSelfReference } from './graph';
import { EdgesHover, NodeHover } from './node_hover';
import { CodeFocus } from './code_viewer';
import { GraphSearchBar } from './graph_search';
import { useGraphSearch } from './lib/use_graph_search';
import { useScreenshot, type ScreenshotMode } from './lib/use_screenshot';
import type { InteractionMode } from './lib/use_interaction_mode';
import {
  type GraphNodeData,
  type GraphEdgeData,
  getNodeAbsolutePosition,
  getNodeSize,
  resizeParentsForNodes,
  useGraphLayout,
} from './lib/use_graph_layout';

export interface GraphViewerHandle {
  centerGraph: () => void;
  fitToView: () => void;
  resetZoom: () => void;
  redrawLayout: () => void;
  openSearch: () => void;
  takeScreenshot: (mode: ScreenshotMode) => void;
}

export interface GraphProps {
  graph: Graph;
  selectFile: (codeFocus: CodeFocus) => void;
  fileContents: Map<string, string>;
  ensureFileContent: (objectId: string) => void;
  revealDirectory: (objectId: string) => void;
  revealQueryRange?: (start: number, end: number) => void;
  autoMerge: boolean;
  effectiveMode: InteractionMode;
  panOnDrag: number[];
  selectionOnDrag: boolean;
}

type ActiveMenu = { kind: 'node' | 'edge'; id: string } | null;

type GraphNodeProps = NodeProps<GraphNodeData>;
type GraphEdgeProps = EdgeProps<GraphEdgeData>;

type MenuContextValue = {
  activeMenu: ActiveMenu;
  setActiveMenu: (menu: ActiveMenu) => void;
};

const MenuContext = React.createContext<MenuContextValue | null>(null);

function dismissContextMenu() {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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

function resolveEdgeObjectId(edge: GraphEdge, graph: Graph): string | null {
  if (edge.from_object) {
    return edge.from_object;
  }

  const node = graph.nodes.get(edge.from);
  return node?.symbol_instances[0]?.object_id ?? null;
}

function GraphNodeComponent({ id, data, selected }: GraphNodeProps) {
  const menuContext = useContext(MenuContext);
  const activeMenu = menuContext?.activeMenu ?? null;
  const setActiveMenu = menuContext?.setActiveMenu;
  const { node, graph, fileContents, ensureFileContent, selectFile, isGroupNode, revealDirectory, revealQueryRange, hiddenRefEdges } = data;
  const displayLabel = data.label ?? node.label;
  const nodeStyle = node.color
    ? ({ '--graph-node-color': node.color } as React.CSSProperties)
    : undefined;
  const isOpen = activeMenu?.kind === 'node' && activeMenu.id === id;
  const isSelected = selected ?? false;
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
    [data, closeMenu],
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
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;

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
    [instanceCount, isDirectoryNode, isOpen, hasHiddenRefs, node, revealDirectory, selectFile, setActiveMenu],
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
            revealQueryRange={revealQueryRange}
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
  selected,
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
  const edges = data?.edges;
  const edgesList = useMemo(() => edges ?? [], [edges]);
  const graph = data?.graph;
  const selectFile = data?.selectFile;
  const isOpen = activeMenu?.kind === 'edge' && activeMenu.id === id;
  const isSelected = selected ?? false;
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
      if (event.shiftKey || event.ctrlKey || event.metaKey) return;
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
    [edgesList, graph, isOpen, selectFile, setActiveMenu],
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

export const GraphViewer = forwardRef<GraphViewerHandle, GraphProps>(function GraphViewer({
  graph,
  selectFile,
  fileContents,
  ensureFileContent,
  revealDirectory,
  revealQueryRange,
  autoMerge,
  effectiveMode,
  panOnDrag,
  selectionOnDrag,
}, ref) {
  const nodeTypes = useMemo(() => ({ graphNode: GraphNodeComponent }), []);
  const edgeTypes = useMemo(() => ({ graphEdge: GraphEdgeComponent }), []);

  const {
    nodes, edges, setNodes,
    handleNodesChange, handleEdgesChange,
    mergedGraph, layoutGen,
    positionsRef, hierarchyRef, nodesRef,
    reactFlowInstanceRef,
    focusNode,
    handleDagreLayout,
  } = useGraphLayout({ graph, selectFile, fileContents, ensureFileContent, revealDirectory, revealQueryRange, autoMerge });

  const [renderAllForCapture, setRenderAllForCapture] = useState(false);
  const handleScreenshot = useScreenshot({ nodesRef, renderAllForCapture, setRenderAll: setRenderAllForCapture, reactFlowInstanceRef });

  const search = useGraphSearch({ mergedGraph, nodes, focusNode });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchOpen = search.open;
  const openSearch = useCallback(() => {
    searchOpen();
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [searchOpen]);

  // Ctrl+F opens graph search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        const el = e.target as HTMLElement;
        const tag = el?.tagName;
        // Allow Ctrl+F when no input is focused, or when the search input itself is focused
        if ((tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) &&
            el !== searchInputRef.current) {
          return;
        }
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch]);

  // Apply search highlight classes to nodes.
  // Returns the same array reference when nothing changed to avoid triggering
  // a nodes → matches → matchSet → setNodes infinite re-render loop.
  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;
      const result = currentNodes.map((node) => {
        let className: string | undefined;
        if (search.matchSet.size > 0 && search.matchSet.has(node.id)) {
          className = node.id === search.currentMatchId
            ? 'graph-node-search-match graph-node-search-active'
            : 'graph-node-search-match';
        }
        if (node.className === className) return node;
        changed = true;
        return { ...node, className };
      });
      return changed ? result : currentNodes;
    });
  }, [search.matchSet, search.currentMatchId, setNodes]);

  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const resolvedActiveMenu = useMemo(() => {
    if (!activeMenu) {
      return null;
    }
    if (activeMenu.kind === 'node' && !mergedGraph.nodes.has(activeMenu.id)) {
      return null;
    }
    if (activeMenu.kind === 'edge' && !mergedGraph.edges.has(activeMenu.id)) {
      return null;
    }
    return activeMenu;
  }, [activeMenu, mergedGraph]);

  const menuContextValue = useMemo(
    () => ({ activeMenu: resolvedActiveMenu, setActiveMenu }),
    [resolvedActiveMenu],
  );

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = instance;
  }, [reactFlowInstanceRef]);

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
  }, [nodes, reactFlowInstanceRef]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: FlowNode<GraphNodeData>) => {
      const selectedCount = nodesRef.current.filter((n) => n.selected).length;
      if (selectedCount > 1) return;
      const hierarchy = hierarchyRef.current;
      if (!hierarchy.childToParent.has(draggedNode.id)) return;
      setNodes((currentNodes) => {
        const resized = resizeParentsForNodes([draggedNode.id], currentNodes, hierarchy);
        positionsRef.current = new Map(resized.map((n) => [n.id, n.position]));
        return resized;
      });
    },
    [setNodes, nodesRef, hierarchyRef, positionsRef],
  );

  const handleSelectionDragStop = useCallback(
    (_event: React.MouseEvent, draggedNodes: FlowNode<GraphNodeData>[]) => {
      const hierarchy = hierarchyRef.current;
      setNodes((currentNodes) => {
        const resized = resizeParentsForNodes(draggedNodes.map((n) => n.id), currentNodes, hierarchy);
        positionsRef.current = new Map(resized.map((n) => [n.id, n.position]));
        return resized;
      });
    },
    [setNodes, hierarchyRef, positionsRef],
  );

  const handleFitToView = useCallback(() => {
    reactFlowInstanceRef.current?.fitView({ padding: 0.2 });
  }, [reactFlowInstanceRef]);

  const handleResetZoom = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }
    const bounds = getNodesBounds(nodes);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    reactFlowInstanceRef.current?.setCenter(centerX, centerY, { zoom: 1 });
  }, [nodes, reactFlowInstanceRef]);

  useImperativeHandle(ref, () => ({
    centerGraph: handleCenterGraph,
    fitToView: handleFitToView,
    resetZoom: handleResetZoom,
    redrawLayout: handleDagreLayout,
    openSearch,
    takeScreenshot: handleScreenshot,
  }), [handleCenterGraph, handleFitToView, handleResetZoom, handleDagreLayout, openSearch, handleScreenshot]);

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
    [setActiveMenu, reactFlowInstanceRef, nodesRef, hierarchyRef],
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
          data-node-count={mergedGraph.nodes.size}
          data-layout-gen={layoutGen}
          style={{ display: 'none' }}
        />
      )}
      <div className="flex-1 relative">
        {search.isOpen && (
          <GraphSearchBar
            query={search.query}
            setQuery={search.setQuery}
            matches={search.matches}
            currentIndex={search.currentIndex}
            goToNext={search.goToNext}
            goToPrevious={search.goToPrevious}
            close={search.close}
            inputRef={searchInputRef}
          />
        )}
        <MenuContext.Provider value={menuContextValue}>
            <ReactFlow
              className={effectiveMode === 'select' ? 'graph-select-mode' : undefined}
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
              onSelectionDragStart={() => setActiveMenu(null)}
              onSelectionDragStop={handleSelectionDragStop}
              onlyRenderVisibleElements={shouldOnlyRenderVisibleElements && !renderAllForCapture}
              nodesDraggable
              panOnDrag={panOnDrag}
              selectionOnDrag={selectionOnDrag}
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode="Shift"
              nodesConnectable={false}
            >
              <Background gap={20} color="var(--graph-grid-color)" />
            </ReactFlow>
        </MenuContext.Provider>
      </div>
    </div>
  );
});
