import type { Edge as FlowEdge, Node as FlowNode } from 'reactflow';
import type { HierarchyInfo } from '../graph';
import { layoutGraph as layoutEngine } from './layout';

export const GROUP_PAD_TOP = 40;
export const GROUP_PAD_LEFT = 10;
export const GROUP_PAD_BOTTOM = 10;
export const GROUP_PAD_RIGHT = 10;

// ── DOM-based measurement (persistent hidden elements) ──────────

// Persistent hidden span for measuring exact node label widths.
// Uses the same CSS class as real graph nodes so the result is pixel-perfect.
let _nodeSpan: HTMLSpanElement | null = null;
let _nodeHeight: number | null = null;

function ensureNodeSpan(): HTMLSpanElement | null {
  if (typeof document === 'undefined') return null;
  if (!_nodeSpan) {
    _nodeSpan = document.createElement('span');
    _nodeSpan.className = 'graph-node';
    _nodeSpan.style.cssText += ';visibility:hidden;position:absolute;white-space:nowrap;pointer-events:none';
    document.body.appendChild(_nodeSpan);
    _nodeSpan.textContent = 'X';
    _nodeHeight = _nodeSpan.offsetHeight;
  }
  return _nodeSpan;
}

function estimateNodeSize(label: string) {
  const span = ensureNodeSpan();
  if (!span) return { width: label.length * 7 + 26, height: 34 }; // SSR fallback
  span.textContent = label;
  return { width: span.offsetWidth, height: _nodeHeight ?? 34 };
}

// Header measurement uses average char width (only needs minimum-width constraint).
let _headerCharWidth: number | null = null;
let _headerPadding: number | null = null;
const HEADER_SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.';

function ensureHeaderMetrics(): { charWidth: number; padding: number } {
  if (_headerCharWidth !== null && _headerPadding !== null) {
    return { charWidth: _headerCharWidth, padding: _headerPadding };
  }
  if (typeof document === 'undefined') return { charWidth: 7, padding: 20 };
  const el = document.createElement('span');
  el.className = 'graph-group-node-header';
  el.style.cssText += ';visibility:hidden;position:absolute;white-space:nowrap;pointer-events:none';
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  _headerPadding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  el.textContent = HEADER_SAMPLE;
  _headerCharWidth = (el.offsetWidth - _headerPadding) / HEADER_SAMPLE.length;
  document.body.removeChild(el);
  return { charWidth: _headerCharWidth, padding: _headerPadding };
}

export function measureGroupHeaderWidth(label: string): number {
  const { charWidth, padding } = ensureHeaderMetrics();
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
  const sizes = measuredSizes ? new Map(measuredSizes) : undefined;

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

    resizeSingleParent(parentNode, children, sizes);
    sizes?.delete(parentId);
  }

  return cloned;
}

export type { HierarchyInfo };

// ── Custom layout adapter ─────────────────────────────────────────

export function layoutGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  previousPositions: Map<string, { x: number; y: number }>,
  hierarchy?: HierarchyInfo,
  measuredSizes?: Map<string, { width: number; height: number }>,
): FlowNode[] {
  const nodeSizes = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    // Prefer measured sizes from a previous render (accurate), fall back to estimates
    const measured = measuredSizes?.get(n.id);
    if (measured) {
      nodeSizes.set(n.id, measured);
    } else {
      const { width, height } = resolveNodeSize(n);
      nodeSizes.set(n.id, { width, height });
    }
  }

  const engineEdges = edges
    .filter(e => e.source !== e.target) // self-loops handled separately by ReactFlow
    .map(e => ({ id: e.id, source: e.source, target: e.target }));

  const result = layoutEngine({
    nodes: nodeSizes,
    edges: engineEdges,
    hierarchy: hierarchy ?? { childToParent: new Map(), parentToChildren: new Map() },
    previousPositions,
    options: {
      direction: 'DOWN',
      layerSpacing: 50,
      nodeSpacing: 30,
      componentGap: 80,
      groupPadding: {
        top: GROUP_PAD_TOP,
        left: GROUP_PAD_LEFT,
        right: GROUP_PAD_RIGHT,
        bottom: GROUP_PAD_BOTTOM,
      },
    },
  });

  return nodes.map(node => {
    const pos = result.positions.get(node.id);
    if (!pos) return node;

    const isGroup = hierarchy?.parentToChildren.has(node.id);
    const dim = isGroup ? result.groupDimensions.get(node.id) : undefined;
    const labelMinWidth = isGroup ? measureGroupHeaderWidth(resolveNodeLabel(node)) : 0;

    return {
      ...node,
      position: pos,
      ...(dim
        ? {
            style: {
              ...(node.style ?? {}),
              width: Math.max(dim.width, labelMinWidth),
              height: dim.height,
            },
          }
        : {}),
    };
  });
}
