/**
 * flat_layout.ts — Flat-graph layout engine.
 *
 * Fresh layouts use dagre for the full layout pipeline.
 * Incremental updates pin existing nodes and place new ones nearby.
 * The hierarchy decomposer in hierarchy.ts calls this once per nesting level.
 */

import dagre from '@dagrejs/dagre';

// ── Types ─────────────────────────────────────────────────────────

export interface EdgeDef {
  id: string;
  source: string;
  target: string;
}

export interface FlatLayoutOptions {
  direction: 'DOWN' | 'RIGHT';
  layerSpacing: number;
  nodeSpacing: number;
  componentGap: number;
}

export interface FlatLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  backEdgeIds: Set<string>;
}

type Pos = { x: number; y: number };
type Size = { width: number; height: number };

// ── Helpers ───────────────────────────────────────────────────────

function addAdj(adj: Map<string, Set<string>>, from: string, to: string) {
  let s = adj.get(from);
  if (!s) { s = new Set(); adj.set(from, s); }
  s.add(to);
}

/** DFS reachability check in an adjacency map. */
function reachable(adj: Map<string, Set<string>>, from: string, to: string): boolean {
  if (from === to) return true;
  const visited = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === to) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const ns = adj.get(cur);
    if (ns) ns.forEach(n => { if (!visited.has(n)) stack.push(n); });
  }
  return false;
}

// ── DAG Construction (cycle breaking) ────────────────────────────

export interface DagResult {
  dagEdges: EdgeDef[];
  backEdgeIds: Set<string>;
}

/**
 * Break cycles via greedy edge insertion with sorted edges for determinism.
 * Returns the DAG edges and the set of back-edge IDs.
 */
export function buildDag(nodeIds: string[], edges: EdgeDef[]): DagResult {
  if (nodeIds.length === 0) {
    return { dagEdges: [], backEdgeIds: new Set() };
  }

  const nodeSet = new Set(nodeIds);
  const valid = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target));

  // Sort edges for determinism
  const sorted = [...valid].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1
      : a.target < b.target ? -1 : a.target > b.target ? 1 : 0,
  );

  const dagEdges: EdgeDef[] = [];
  const backEdgeIds = new Set<string>();
  const dagAdj = new Map<string, Set<string>>();

  for (const e of sorted) {
    if (e.source === e.target) { backEdgeIds.add(e.id); continue; }
    if (!reachable(dagAdj, e.target, e.source)) {
      dagEdges.push(e); addAdj(dagAdj, e.source, e.target);
    } else {
      backEdgeIds.add(e.id);
    }
  }

  return { dagEdges, backEdgeIds };
}

// ── Fresh layout via dagre ───────────────────────────────────────

export function freshLayout(
  nodeIds: string[],
  nodeSizes: Map<string, Size>,
  dagEdges: EdgeDef[],
  options: Pick<FlatLayoutOptions, 'layerSpacing' | 'nodeSpacing'>,
): Map<string, Pos> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: options.nodeSpacing, ranksep: options.layerSpacing });
  g.setDefaultEdgeLabel(() => ({}));

  for (const id of nodeIds) {
    const s = nodeSizes.get(id) ?? { width: 180, height: 40 };
    g.setNode(id, { width: s.width, height: s.height });
  }
  for (const e of dagEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positions = new Map<string, Pos>();
  for (const id of nodeIds) {
    const n = g.node(id);
    if (!n) continue;
    const s = nodeSizes.get(id) ?? { width: 180, height: 40 };
    positions.set(id, { x: n.x - s.width / 2, y: n.y - s.height / 2 });
  }
  return positions;
}

// ── Incremental layout: pin existing, place new nearby ───────────

export function placeNewNodes(
  nodeIds: string[],
  nodeSizes: Map<string, Size>,
  edges: EdgeDef[],
  previousPositions: Map<string, Pos>,
  options: Pick<FlatLayoutOptions, 'layerSpacing' | 'nodeSpacing'>,
): Map<string, Pos> {
  const positions = new Map<string, Pos>();
  const { layerSpacing, nodeSpacing } = options;

  // 1. Pin existing nodes
  for (const id of nodeIds) {
    const prev = previousPositions.get(id);
    if (prev) positions.set(id, prev);
  }

  // Build bidirectional adjacency + directed parent/child sets
  const neighbors = new Map<string, string[]>();
  const parents = new Map<string, string[]>();   // nodes with edges TO this node
  const children = new Map<string, string[]>();  // nodes with edges FROM this node
  for (const id of nodeIds) { neighbors.set(id, []); parents.set(id, []); children.set(id, []); }
  const nodeSet = new Set(nodeIds);
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
    neighbors.get(e.source)!.push(e.target);
    neighbors.get(e.target)!.push(e.source);
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  }

  // 2. Place new nodes via BFS from positioned nodes
  const placed = new Set<string>();
  const queue: string[] = [];
  for (const id of nodeIds) {
    if (positions.has(id)) { placed.add(id); queue.push(id); }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nbr of neighbors.get(cur) ?? []) {
      if (placed.has(nbr)) continue;
      placed.add(nbr);
      queue.push(nbr);

      const w = nodeSizes.get(nbr)?.width ?? 180;
      const h = nodeSizes.get(nbr)?.height ?? 40;
      const posNbrs = (neighbors.get(nbr) ?? []).filter(n => positions.has(n));
      if (posNbrs.length > 0) {
        // X: median of positioned neighbors' centers
        const xs = posNbrs.map(n => {
          const p = positions.get(n)!;
          return p.x + (nodeSizes.get(n)?.width ?? 180) / 2;
        });
        xs.sort((a, b) => a - b);
        let x = xs[Math.floor(xs.length / 2)] - w / 2;

        // Y: use directed edges to determine above vs below.
        // Positioned parents → place below them.  Positioned children → place above them.
        const posParents = (parents.get(nbr) ?? []).filter(n => positions.has(n));
        const posChildren = (children.get(nbr) ?? []).filter(n => positions.has(n));

        let y: number;
        if (posParents.length > 0 && posChildren.length === 0) {
          // Has parents only → place below the lowest parent
          let maxBottom = -Infinity;
          for (const n of posParents) {
            const p = positions.get(n)!;
            maxBottom = Math.max(maxBottom, p.y + (nodeSizes.get(n)?.height ?? 40));
          }
          y = maxBottom + layerSpacing;
        } else if (posChildren.length > 0 && posParents.length === 0) {
          // Has children only → place above the highest child
          let minTop = Infinity;
          for (const n of posChildren) {
            minTop = Math.min(minTop, positions.get(n)!.y);
          }
          y = minTop - h - layerSpacing;
        } else {
          // Mixed or fallback → place below the lowest neighbor
          let maxBottom = -Infinity;
          for (const n of posNbrs) {
            const p = positions.get(n)!;
            maxBottom = Math.max(maxBottom, p.y + (nodeSizes.get(n)?.height ?? 40));
          }
          y = maxBottom + layerSpacing;
        }

        // Resolve overlaps: find max right edge of all overlapping nodes in one pass,
        // repeat until x stops changing.  Bounded to prevent infinite loops.
        const maxIter = positions.size + 1;
        for (let iter = 0; iter < maxIter; iter++) {
          let newX = x;
          positions.forEach((op, oid) => {
            if (oid === nbr) return;
            const ow = nodeSizes.get(oid)?.width ?? 180;
            const oh = nodeSizes.get(oid)?.height ?? 40;
            const xOverlap = newX < op.x + ow + nodeSpacing && newX + w + nodeSpacing > op.x;
            const yOverlap = y < op.y + oh && y + h > op.y;
            if (xOverlap && yOverlap) newX = Math.max(newX, op.x + ow + nodeSpacing);
          });
          if (newX === x) break;
          x = newX;
        }

        positions.set(nbr, { x, y });
      } else {
        positions.set(nbr, { x: 0, y: 0 });
      }
    }
  }

  // 3. Handle isolated new nodes
  for (const id of nodeIds) {
    if (!positions.has(id)) {
      let maxRight = 0;
      positions.forEach((p, pid) => {
        maxRight = Math.max(maxRight, p.x + (nodeSizes.get(pid)?.width ?? 180));
      });
      positions.set(id, { x: maxRight + nodeSpacing, y: 0 });
    }
  }

  return positions;
}

// ── Connected Components ─────────────────────────────────────────

export function findComponents(nodeIds: string[], edges: EdgeDef[]): string[][] {
  if (nodeIds.length === 0) return [];
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const id of nodeIds) { parent.set(id, id); rank.set(id, 0); }

  function find(x: string): string {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; }
    return x;
  }
  function union(a: string, b: string) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank.get(ra)! < rank.get(rb)!) [ra, rb] = [rb, ra];
    parent.set(rb, ra);
    if (rank.get(ra) === rank.get(rb)) rank.set(ra, rank.get(ra)! + 1);
  }

  const ns = new Set(nodeIds);
  for (const e of edges) { if (ns.has(e.source) && ns.has(e.target)) union(e.source, e.target); }

  const groups = new Map<string, string[]>();
  for (const id of nodeIds) {
    const r = find(id);
    let arr = groups.get(r);
    if (!arr) { arr = []; groups.set(r, arr); }
    arr.push(id);
  }
  return Array.from(groups.values()).sort((a, b) => b.length - a.length);
}

// ── Main Entry Point ─────────────────────────────────────────────

export function layoutFlat(
  nodes: Map<string, Size>,
  edges: EdgeDef[],
  previousPositions: Map<string, Pos>,
  options: FlatLayoutOptions,
): FlatLayoutResult {
  const nodeIds = Array.from(nodes.keys());
  if (nodeIds.length === 0) return { positions: new Map(), backEdgeIds: new Set() };

  // For RIGHT direction: swap width↔height and x↔y, compute as DOWN, swap back
  const isRight = options.direction === 'RIGHT';
  const effectiveNodes = isRight
    ? new Map(Array.from(nodes).map(([id, s]) => [id, { width: s.height, height: s.width }] as [string, Size]))
    : nodes;
  const effectivePrev = isRight
    ? new Map(Array.from(previousPositions).map(([id, p]) => [id, { x: p.y, y: p.x }] as [string, Pos]))
    : previousPositions;
  const effectiveOpts = { ...options, direction: 'DOWN' as const };

  const components = findComponents(nodeIds, edges);
  const allPos = new Map<string, Pos>();
  const allBack = new Set<string>();

  interface CompResult { positions: Map<string, Pos>; anchored: boolean; right: number }
  const results: CompResult[] = [];

  for (const compIds of components) {
    const compSet = new Set(compIds);
    const compEdges = edges.filter(e => compSet.has(e.source) && compSet.has(e.target));
    const compSizes = new Map<string, Size>();
    for (const id of compIds) compSizes.set(id, effectiveNodes.get(id)!);

    const { dagEdges, backEdgeIds } = buildDag(compIds, compEdges);
    backEdgeIds.forEach(id => allBack.add(id));

    const anchored = compIds.some(id => effectivePrev.has(id));

    const positions = anchored
      ? placeNewNodes(compIds, compSizes, compEdges, effectivePrev, effectiveOpts)
      : freshLayout(compIds, compSizes, dagEdges, effectiveOpts);

    let right = -Infinity;
    positions.forEach((p, id) => { right = Math.max(right, p.x + (compSizes.get(id)?.width ?? 0)); });
    results.push({ positions, anchored, right });
  }

  // Arrange components: anchored first, then floating to the right
  let maxRight = -Infinity;
  let minAnchoredY = Infinity;
  for (const r of results) {
    if (r.anchored) {
      r.positions.forEach((p, id) => {
        allPos.set(id, p);
        minAnchoredY = Math.min(minAnchoredY, p.y);
      });
      maxRight = Math.max(maxRight, r.right);
    }
  }
  let curX = Number.isFinite(maxRight) ? maxRight + effectiveOpts.componentGap : 0;
  for (const r of results) {
    if (!r.anchored) {
      let minX = Infinity, minY = Infinity;
      r.positions.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); });
      const offX = curX - (Number.isFinite(minX) ? minX : 0);
      const offY = Number.isFinite(minAnchoredY) ? minAnchoredY - (Number.isFinite(minY) ? minY : 0) : 0;
      r.positions.forEach((p, id) => allPos.set(id, { x: p.x + offX, y: p.y + offY }));
      curX = r.right + offX + effectiveOpts.componentGap;
    }
  }

  if (isRight) {
    allPos.forEach((p, id) => allPos.set(id, { x: p.y, y: p.x }));
  }

  return { positions: allPos, backEdgeIds: allBack };
}
