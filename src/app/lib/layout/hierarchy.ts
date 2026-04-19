/**
 * hierarchy.ts — Nesting decomposer for hierarchical graph layout.
 *
 * Orchestrates bottom-up calls to a flat layout engine: processes deepest
 * groups first, computes group dimensions from children bounds, lifts
 * cross-group edges to parent level, and converts positions between
 * group-relative and absolute coordinate systems.
 *
 * The flat backend is pluggable — passed as `flatLayoutFn`.
 */

import type { EdgeDef, FlatLayoutOptions, FlatLayoutResult } from './flat_layout';

// ── Types ─────────────────────────────────────────────────────────

export interface HierarchyInfo {
  childToParent: Map<string, string>;
  parentToChildren: Map<string, Set<string>>;
}

export interface GroupPadding {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

type Pos = { x: number; y: number };
type Size = { width: number; height: number };

export type FlatLayoutFn = (
  nodes: Map<string, Size>,
  edges: EdgeDef[],
  previousPositions: Map<string, Pos>,
  options: FlatLayoutOptions,
) => FlatLayoutResult;

export interface DecomposeResult {
  positions: Map<string, Pos>;
  groupDimensions: Map<string, Size>;
  backEdgeIds: Set<string>;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Nesting depth: 0 for top-level, 1 for children of top-level groups, etc. */
export function computeNestingDepth(nodeId: string, hierarchy: HierarchyInfo): number {
  let depth = 0;
  let cur = hierarchy.childToParent.get(nodeId);
  while (cur) { depth++; cur = hierarchy.childToParent.get(cur); }
  return depth;
}

/**
 * Compute group bounding box from children positions + padding.
 *
 * Returns the group dimensions and the shift needed to move children
 * so their bounding box starts at `(padding.left, padding.top)`.
 */
export function computeGroupBounds(
  positions: Map<string, Pos>,
  sizes: Map<string, Size>,
  padding: GroupPadding,
): { width: number; height: number; shiftX: number; shiftY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  positions.forEach((pos, id) => {
    const s = sizes.get(id) ?? { width: 180, height: 40 };
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + s.width);
    maxY = Math.max(maxY, pos.y + s.height);
  });
  if (!Number.isFinite(minX)) {
    return { width: padding.left + padding.right, height: padding.top + padding.bottom, shiftX: 0, shiftY: 0 };
  }
  const shiftX = padding.left - minX;
  const shiftY = padding.top - minY;
  return {
    width: (maxX - minX) + padding.left + padding.right,
    height: (maxY - minY) + padding.top + padding.bottom,
    shiftX,
    shiftY,
  };
}

/**
 * Walk `nodeId` up the hierarchy until landing on a node in `participants`.
 * Returns undefined if the node can't reach any participant.
 */
function walkToParticipant(
  nodeId: string,
  hierarchy: HierarchyInfo,
  participants: Set<string>,
): string | undefined {
  let cur: string | undefined = nodeId;
  while (cur !== undefined) {
    if (participants.has(cur)) return cur;
    cur = hierarchy.childToParent.get(cur);
  }
  return undefined;
}

/**
 * Project all edges onto a set of participants by walking each endpoint
 * up the hierarchy.  Intra-group edges (both endpoints lift to the same
 * participant) are dropped.  Duplicate source→target pairs are merged.
 *
 * Direct edges between participants keep their original ID (important for
 * back-edge tracking).  Lifted edges get synthetic IDs prefixed `lifted:`.
 */
function getEdgesForLevel(
  edges: EdgeDef[],
  hierarchy: HierarchyInfo,
  participants: Set<string>,
): EdgeDef[] {
  const result: EdgeDef[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const es = walkToParticipant(e.source, hierarchy, participants);
    const et = walkToParticipant(e.target, hierarchy, participants);
    if (!es || !et || es === et) continue;
    const key = `${es}\0${et}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isLifted = es !== e.source || et !== e.target;
    result.push({ id: isLifted ? `lifted:${es}:${et}` : e.id, source: es, target: et });
  }
  return result;
}

// ── Main Decomposer ──────────────────────────────────────────────

export function decomposeAndLayout(
  nodes: Map<string, Size>,
  edges: EdgeDef[],
  hierarchy: HierarchyInfo,
  previousPositions: Map<string, Pos>,
  options: FlatLayoutOptions & { groupPadding: GroupPadding },
  flatLayoutFn: FlatLayoutFn,
): DecomposeResult {
  const positions = new Map<string, Pos>();
  const groupDims = new Map<string, Size>();
  const backEdgeIds = new Set<string>();

  // Sort groups deepest-first
  const groupIds = Array.from(hierarchy.parentToChildren.keys());
  groupIds.sort((a, b) => computeNestingDepth(b, hierarchy) - computeNestingDepth(a, hierarchy));

  // ── Bottom-up: process each group's children ───────────────────

  for (const gid of groupIds) {
    const childSet = hierarchy.parentToChildren.get(gid)!;
    if (childSet.size === 0) continue;
    const participants = new Set(Array.from(childSet));

    // Node sizes: computed group dims for sub-groups, input for leaves
    const childSizes = new Map<string, Size>();
    participants.forEach(cid => {
      childSizes.set(cid, groupDims.get(cid) ?? nodes.get(cid) ?? { width: 180, height: 40 });
    });

    const levelEdges = getEdgesForLevel(edges, hierarchy, participants);

    // Previous positions for children (group-relative, matching positionsRef convention)
    const childPrev = new Map<string, Pos>();
    participants.forEach(cid => {
      const p = previousPositions.get(cid);
      if (p) childPrev.set(cid, p);
    });

    const result = flatLayoutFn(childSizes, levelEdges, childPrev, options);

    // Collect non-lifted back edges
    result.backEdgeIds.forEach(id => {
      if (!id.startsWith('lifted:')) backEdgeIds.add(id);
    });

    // Shift children so bbox starts at (padLeft, padTop); compute group size
    const bounds = computeGroupBounds(result.positions, childSizes, options.groupPadding);
    groupDims.set(gid, { width: bounds.width, height: bounds.height });

    result.positions.forEach((pos, id) => {
      positions.set(id, { x: pos.x + bounds.shiftX, y: pos.y + bounds.shiftY });
    });
  }

  // ── Top level ──────────────────────────────────────────────────

  const topIds = Array.from(nodes.keys()).filter(id => !hierarchy.childToParent.has(id));
  const topSizes = new Map<string, Size>();
  for (const id of topIds) {
    topSizes.set(id, groupDims.get(id) ?? nodes.get(id) ?? { width: 180, height: 40 });
  }

  const topParticipants = new Set(topIds);
  const topEdges = getEdgesForLevel(edges, hierarchy, topParticipants);

  const topPrev = new Map<string, Pos>();
  for (const id of topIds) {
    const p = previousPositions.get(id);
    if (p) topPrev.set(id, p);
  }

  const topResult = flatLayoutFn(topSizes, topEdges, topPrev, options);
  topResult.backEdgeIds.forEach(id => {
    if (!id.startsWith('lifted:')) backEdgeIds.add(id);
  });
  topResult.positions.forEach((pos, id) => positions.set(id, pos));

  return { positions, groupDimensions: groupDims, backEdgeIds };
}
