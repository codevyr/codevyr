import ELK from 'elkjs/lib/elk.bundled.js';
import dagre from 'dagre';
import type { Edge as FlowEdge, Node as FlowNode } from 'reactflow';
import type { HierarchyInfo } from '../graph';

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 40;
const MAX_NODE_WIDTH = 320;
const CHAR_WIDTH = 7;

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

function resolveNodeLabel(node: FlowNode) {
  return typeof (node.data as any)?.label === 'string'
    ? (node.data as any).label
    : String((node.data as any)?.node?.label ?? node.id);
}

function resolveNodeSize(node: FlowNode) {
  const label = resolveNodeLabel(node);
  const size = estimateNodeSize(label);
  const measuredWidth = (node as any).measured?.width ?? node.width;
  const measuredHeight = (node as any).measured?.height ?? node.height;
  return {
    label,
    width: measuredWidth ?? size.width,
    height: measuredHeight ?? size.height,
  };
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
          'elk.padding': '[top=40,left=10,bottom=10,right=10]',
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
