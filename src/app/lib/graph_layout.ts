import ELK from 'elkjs/lib/elk.bundled.js';
import dagre from 'dagre';
import type { Edge as FlowEdge, Node as FlowNode } from 'reactflow';
import type { HierarchyInfo } from '../graph';

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 40;
const MAX_NODE_WIDTH = 320;
const CHAR_WIDTH = 7;

export const GROUP_PAD_TOP = 40;
export const GROUP_PAD_LEFT = 10;
export const GROUP_PAD_BOTTOM = 10;
export const GROUP_PAD_RIGHT = 10;

function estimateNodeSize(label: string) {
  const width = Math.min(
    MAX_NODE_WIDTH,
    Math.max(DEFAULT_NODE_WIDTH, label.length * CHAR_WIDTH + 32),
  );
  return {
    width,
    height: DEFAULT_NODE_HEIGHT,
  };
}

/**
 * Measures the per-character width and horizontal padding of a
 * .graph-group-node-header element.  Uses the actual CSS class so the result
 * stays correct regardless of font, DPI, or root font-size.
 *
 * Both values are measured with a single hidden DOM element and cached for
 * the lifetime of the page.
 */
let _cachedHeaderMetrics: { charWidth: number; padding: number } | null = null;

function measureHeaderMetrics(): { charWidth: number; padding: number } {
  if (_cachedHeaderMetrics !== null) return _cachedHeaderMetrics;
  if (typeof document === 'undefined') return { charWidth: 7, padding: 20 }; // SSR fallback
  const span = document.createElement('span');
  span.className = 'graph-group-node-header';
  span.style.cssText += ';visibility:hidden;position:absolute;white-space:nowrap;pointer-events:none';
  document.body.appendChild(span);
  const cs = getComputedStyle(span);
  const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  // Measure average char width with representative text, subtracting padding.
  const sampleText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.';
  span.textContent = sampleText;
  const charWidth = (span.offsetWidth - padding) / sampleText.length;
  document.body.removeChild(span);
  _cachedHeaderMetrics = { charWidth, padding };
  return _cachedHeaderMetrics;
}

export function measureGroupHeaderWidth(label: string): number {
  const { charWidth, padding } = measureHeaderMetrics();
  return Math.ceil(label.length * charWidth + padding);
}

function resolveNodeLabel(node: FlowNode) {
  return typeof (node.data as any)?.label === 'string'
    ? (node.data as any).label
    : String((node.data as any)?.node?.label ?? node.id);
}

export function resolveNodeSize(node: FlowNode) {
  const label = resolveNodeLabel(node);
  const size = estimateNodeSize(label);
  const styleW = typeof node.style?.width === 'number' ? node.style.width : undefined;
  const styleH = typeof node.style?.height === 'number' ? node.style.height : undefined;
  const measuredWidth = (node as any).measured?.width ?? node.width;
  const measuredHeight = (node as any).measured?.height ?? node.height;
  return {
    label,
    width: styleW ?? measuredWidth ?? size.width,
    height: styleH ?? measuredHeight ?? size.height,
  };
}

/**
 * Recomputes a single parent's position and style from its children's bounding
 * box.  Mutates `parentNode` and `children` in place.  Returns false if the
 * bounding box could not be computed (no finite positions).
 */
export function resizeSingleParent(
  parentNode: FlowNode,
  children: FlowNode[],
  measuredSizes?: Map<string, { width: number; height: number }>,
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of children) {
    const { width, height } = measuredSizes?.get(child.id) ?? resolveNodeSize(child);
    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + width);
    maxY = Math.max(maxY, child.position.y + height);
  }

  if (!Number.isFinite(minX)) return false;

  const shiftX = GROUP_PAD_LEFT - minX;
  const shiftY = GROUP_PAD_TOP - minY;

  if (shiftX !== 0 || shiftY !== 0) {
    parentNode.position = {
      x: parentNode.position.x - shiftX,
      y: parentNode.position.y - shiftY,
    };
    for (const child of children) {
      child.position = {
        x: child.position.x + shiftX,
        y: child.position.y + shiftY,
      };
    }
    maxX += shiftX;
    maxY += shiftY;
  }

  const childrenWidth = maxX + GROUP_PAD_RIGHT;
  const labelMinWidth = measureGroupHeaderWidth(resolveNodeLabel(parentNode));
  parentNode.style = {
    ...(parentNode.style ?? {}),
    width: Math.max(childrenWidth, labelMinWidth),
    height: maxY + GROUP_PAD_BOTTOM,
  };

  return true;
}

export function adjustParentDimensions(
  nodes: FlowNode[],
  hierarchy: HierarchyInfo,
  measuredSizes?: Map<string, { width: number; height: number }>,
): FlowNode[] {
  const cloned = nodes.map((n) => ({
    ...n,
    position: { ...n.position },
    style: n.style ? { ...n.style } : undefined,
  }));
  const nodeMap = new Map(cloned.map((n) => [n.id, n]));

  // Collect all parent IDs and compute their depth (distance to root).
  const parentIds = Array.from(hierarchy.parentToChildren.keys());

  const depthCache = new Map<string, number>();
  function getDepth(id: string): number {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const parent = hierarchy.childToParent.get(id);
    const depth = parent ? getDepth(parent) + 1 : 0;
    depthCache.set(id, depth);
    return depth;
  }

  // Sort deepest first (bottom-up).
  parentIds.sort((a, b) => getDepth(b) - getDepth(a));

  for (const parentId of parentIds) {
    const parentNode = nodeMap.get(parentId);
    if (!parentNode) continue;

    const childIdSet = hierarchy.parentToChildren.get(parentId);
    if (!childIdSet || childIdSet.size === 0) continue;

    const children: FlowNode[] = [];
    childIdSet.forEach((childId) => {
      const child = nodeMap.get(childId);
      if (child) children.push(child);
    });
    if (children.length === 0) continue;

    resizeSingleParent(parentNode, children, measuredSizes);
  }

  return cloned;
}

function pruneEdgesForLayout(edges: FlowEdge[]) {
  const adjacency = new Map<string, Set<string>>();
  const pruned: FlowEdge[] = [];

  const createsCycle = (source: string, target: string) => {
    if (source === target) {
      return true;
    }

    const visited = new Set<string>();
    const stack: string[] = [target];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === source) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const neighbors = adjacency.get(current);
      if (!neighbors) {
        continue;
      }
      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      });
    }

    return false;
  };

  const addAdjacency = (source: string, target: string) => {
    let neighbors = adjacency.get(source);
    if (!neighbors) {
      neighbors = new Set<string>();
      adjacency.set(source, neighbors);
    }
    neighbors.add(target);
  };

  edges.forEach((edge) => {
    if (createsCycle(edge.source, edge.target)) {
      return;
    }
    addAdjacency(edge.source, edge.target);
    pruned.push(edge);
  });

  return pruned;
}

export type { HierarchyInfo };

export type LayoutOptions = {
  direction?: 'DOWN' | 'RIGHT';
  layerSpacing?: number;
  nodeSpacing?: number;
  preserveExisting?: boolean;
  positions?: Map<string, { x: number; y: number }>;
  incremental?: boolean;
  hierarchy?: HierarchyInfo;
};

export type DagreLayoutOptions = Pick<LayoutOptions, 'direction' | 'layerSpacing' | 'nodeSpacing'>;

function buildElkNode(
  node: FlowNode,
  preserveExisting: boolean,
  positions: Map<string, { x: number; y: number }>,
) {
  const { width, height } = resolveNodeSize(node);
  const existingPosition = positions.get(node.id);
  const shouldPreserve = preserveExisting && existingPosition;
  return {
    id: node.id,
    width,
    height,
    ...(shouldPreserve
      ? { x: existingPosition.x, y: existingPosition.y }
      : {}),
    layoutOptions: shouldPreserve ? { 'elk.fixed': 'true' } : undefined,
  };
}

function buildNestedElkChildren(
  nodeIds: string[],
  nodeMap: Map<string, FlowNode>,
  hierarchy: HierarchyInfo,
  preserveExisting: boolean,
  positions: Map<string, { x: number; y: number }>,
): any[] {
  const result: any[] = [];
  for (const id of nodeIds) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const children = hierarchy.parentToChildren.get(id);
    if (children && children.size > 0) {
      // Parent node — don't set width/height, let ELK compute from children
      const existingPosition = positions.get(id);
      const shouldPreserve = preserveExisting && existingPosition;
      result.push({
        id,
        ...(shouldPreserve
          ? { x: existingPosition.x, y: existingPosition.y }
          : {}),
        layoutOptions: {
          ...(shouldPreserve ? { 'elk.fixed': 'true' } : {}),
          'elk.padding': `[top=${GROUP_PAD_TOP},left=${GROUP_PAD_LEFT},bottom=${GROUP_PAD_BOTTOM},right=${GROUP_PAD_RIGHT}]`,
          'elk.algorithm': 'layered',
        },
        children: buildNestedElkChildren(
          Array.from(children),
          nodeMap,
          hierarchy,
          preserveExisting,
          positions,
        ),
      });
    } else {
      result.push(buildElkNode(node, preserveExisting, positions));
    }
  }
  return result;
}

function collectLayoutNodes(
  elkChildren: any[],
  layoutNodes: Map<string, any>,
) {
  for (const child of elkChildren) {
    layoutNodes.set(child.id, child);
    if (child.children) {
      collectLayoutNodes(child.children, layoutNodes);
    }
  }
}

export async function layoutGraphWithElk(
  nodes: FlowNode[],
  edges: FlowEdge[],
  {
    direction = 'DOWN',
    layerSpacing = 8,
    nodeSpacing = 10,
    preserveExisting = false,
    positions = new Map<string, { x: number; y: number }>(),
    incremental = true,
    hierarchy,
  }: LayoutOptions,
) {
  const layoutEdges = pruneEdgesForLayout(edges);
  const resolvedLayerSpacing = layerSpacing;
  const resolvedNodeSpacing = nodeSpacing;
  const resolvedEdgeSpacing = 1;
  const edgeTrackFactor = 0.5;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const hasHierarchy = hierarchy && hierarchy.childToParent.size > 0;

  let elkChildren: any[];
  if (hasHierarchy) {
    // Build root-level node IDs (those without a parent)
    const rootNodeIds = nodes
      .map((n) => n.id)
      .filter((id) => !hierarchy.childToParent.has(id));
    elkChildren = buildNestedElkChildren(
      rootNodeIds,
      nodeMap,
      hierarchy,
      preserveExisting,
      positions,
    );
  } else {
    elkChildren = nodes.map((node) =>
      buildElkNode(node, preserveExisting, positions),
    );
  }

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': String(resolvedNodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(resolvedLayerSpacing),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(resolvedEdgeSpacing),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(resolvedEdgeSpacing),
      'elk.layered.edgeRouting.splines.mode': 'SLOPPY',
      'elk.layered.edgeRouting.splines.sloppy.layerSpacingFactor': String(edgeTrackFactor),
      'elk.edgeRouting': 'POLYLINE',
      'elk.incremental': String(incremental),
      ...(hasHierarchy
        ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }
        : {}),
    },
    children: elkChildren,
    // All edges at root level — ELK handles cross-hierarchy routing
    edges: layoutEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layout = await elk.layout(elkGraph);
  const layoutNodes = new Map<string, any>();
  collectLayoutNodes(layout.children ?? [], layoutNodes);

  return nodes.map((node) => {
    const layoutNode = layoutNodes.get(node.id);
    if (!layoutNode) {
      return node;
    }
    if (preserveExisting && positions.has(node.id)) {
      return { ...node, position: positions.get(node.id)! };
    }
    const isParent =
      hasHierarchy && hierarchy.parentToChildren.has(node.id);
    const result: FlowNode = {
      ...node,
      position: {
        x: layoutNode.x ?? node.position.x,
        y: layoutNode.y ?? node.position.y,
      },
    };
    if (isParent) {
      result.style = {
        ...(result.style ?? {}),
        width: layoutNode.width,
        height: layoutNode.height,
      };
    }
    return result;
  });
}

export async function layoutGraphWithDagre(
  nodes: FlowNode[],
  edges: FlowEdge[],
  {
    direction = 'DOWN',
    layerSpacing = 60,
    nodeSpacing = 30,
  }: DagreLayoutOptions = {},
) {
  const layoutEdges = pruneEdgesForLayout(edges);
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction === 'RIGHT' ? 'LR' : 'TB',
    nodesep: nodeSpacing,
    ranksep: layerSpacing,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    const { width, height } = resolveNodeSize(node);
    graph.setNode(node.id, { width, height });
  });

  layoutEdges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return nodes.map((node) => {
    const layoutNode = graph.node(node.id);
    if (!layoutNode) {
      return node;
    }
    const { width, height } = resolveNodeSize(node);
    return {
      ...node,
      position: {
        x: layoutNode.x - width / 2,
        y: layoutNode.y - height / 2,
      },
    };
  });
}
