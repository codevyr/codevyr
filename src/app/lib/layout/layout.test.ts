import { describe, it, expect } from 'vitest';
import { buildDag, findComponents, placeNewNodes, layoutFlat } from './flat_layout';
import type { EdgeDef, FlatLayoutOptions } from './flat_layout';
import { computeGroupBounds, decomposeAndLayout, computeNestingDepth } from './hierarchy';
import type { HierarchyInfo, GroupPadding } from './hierarchy';
import { layoutGraph } from './index';

// ── Helpers ───────────────────────────────────────────────────────

function edge(source: string, target: string, id?: string): EdgeDef {
  return { id: id ?? `${source}->${target}`, source, target };
}

function sizes(...ids: string[]): Map<string, { width: number; height: number }> {
  const m = new Map<string, { width: number; height: number }>();
  for (const id of ids) m.set(id, { width: 100, height: 40 });
  return m;
}

const defaultOpts: FlatLayoutOptions = {
  direction: 'DOWN',
  layerSpacing: 50,
  nodeSpacing: 30,
  componentGap: 80,
};

const defaultPad: GroupPadding = { top: 40, left: 10, right: 10, bottom: 10 };

function noOverlaps(
  positions: Map<string, { x: number; y: number }>,
  nodeSizes: Map<string, { width: number; height: number }>,
  minSpacing = 0,
): boolean {
  const entries = Array.from(positions.entries());
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [idA, posA] = entries[i];
      const [idB, posB] = entries[j];
      const sA = nodeSizes.get(idA) ?? { width: 100, height: 40 };
      const sB = nodeSizes.get(idB) ?? { width: 100, height: 40 };
      // Full 2D AABB overlap check (spacing applied to both axes)
      const xOverlap = posA.x < posB.x + sB.width + minSpacing &&
                        posA.x + sA.width + minSpacing > posB.x;
      const yOverlap = posA.y < posB.y + sB.height + minSpacing &&
                        posA.y + sA.height + minSpacing > posB.y;
      if (xOverlap && yOverlap) return false;
    }
  }
  return true;
}

// ── DAG Construction ─────────────────────────────────────────────

describe('buildDag', () => {
  it('keeps all edges in an acyclic graph', () => {
    const r = buildDag(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]);
    expect(r.backEdgeIds.size).toBe(0);
    expect(r.dagEdges.length).toBe(2);
  });

  it('handles a diamond shape without back edges', () => {
    const r = buildDag(
      ['a', 'b', 'c', 'd'],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    expect(r.backEdgeIds.size).toBe(0);
    expect(r.dagEdges.length).toBe(4);
  });

  it('detects back edges in a cycle', () => {
    const r = buildDag(['a', 'b', 'c'], [
      edge('a', 'b'), edge('b', 'c'), edge('c', 'a', 'back'),
    ]);
    expect(r.backEdgeIds.has('back')).toBe(true);
    expect(r.dagEdges.length).toBe(2);
  });

  it('classifies self-loops as back edges', () => {
    const r = buildDag(['a'], [edge('a', 'a', 'self')]);
    expect(r.backEdgeIds.has('self')).toBe(true);
    expect(r.dagEdges.length).toBe(0);
  });

  it('is deterministic across repeated calls', () => {
    const args: [string[], EdgeDef[]] = [
      ['c', 'a', 'b'],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a', 'back')],
    ];
    const r1 = buildDag(...args);
    const r2 = buildDag(...args);
    expect(r1.dagEdges.map(e => e.id)).toEqual(r2.dagEdges.map(e => e.id));
    expect(Array.from(r1.backEdgeIds)).toEqual(Array.from(r2.backEdgeIds));
  });

  it('handles a graph with no edges', () => {
    const r = buildDag(['a', 'b'], []);
    expect(r.dagEdges.length).toBe(0);
    expect(r.backEdgeIds.size).toBe(0);
  });

  it('picks a root when all nodes are in cycles', () => {
    const r = buildDag(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    expect(r.dagEdges.length).toBe(1);
    expect(r.backEdgeIds.size).toBe(1);
  });
});

// ── Incremental placement ────────────────────────────────────────

describe('placeNewNodes', () => {
  it('pins existing nodes at their previous positions', () => {
    const s = sizes('a', 'b');
    const prev = new Map([['a', { x: 200, y: 55 }]]);
    const pos = placeNewNodes(['a', 'b'], s, [edge('a', 'b')], prev, defaultOpts);
    expect(pos.get('a')!.x).toBe(200);
    expect(pos.get('a')!.y).toBe(55);
  });

  it('places new node near its positioned neighbor', () => {
    const s = sizes('a', 'b');
    const prev = new Map([['a', { x: 100, y: 50 }]]);
    const pos = placeNewNodes(['a', 'b'], s, [edge('a', 'b')], prev, defaultOpts);
    // b should be near a horizontally (centered under a)
    const aCenterX = 100 + 50;
    const bCenterX = pos.get('b')!.x + 50;
    expect(Math.abs(bCenterX - aCenterX)).toBeLessThan(5);
    // b should be below a
    expect(pos.get('b')!.y).toBeGreaterThan(pos.get('a')!.y);
  });

  it('handles isolated new node', () => {
    const s = sizes('a', 'b');
    const prev = new Map([['a', { x: 100, y: 50 }]]);
    // b has no edges — isolated
    const pos = placeNewNodes(['a', 'b'], s, [], prev, defaultOpts);
    expect(pos.has('b')).toBe(true);
  });

  it('resolves overlaps when new node must shift past multiple existing nodes', () => {
    const s = sizes('a', 'b', 'c', 'd', 'p');
    const prev = new Map<string, { x: number; y: number }>([
      ['a', { x: 0, y: 90 }],
      ['b', { x: 130, y: 90 }],
      ['c', { x: 260, y: 90 }],
      ['p', { x: 130, y: 0 }],
    ]);
    // d connects to p — its idealX lands on top of a,b,c row, must shift past them
    const pos = placeNewNodes(
      ['a', 'b', 'c', 'd', 'p'], s,
      [edge('p', 'a'), edge('p', 'b'), edge('p', 'c'), edge('p', 'd')],
      prev, defaultOpts,
    );
    expect(noOverlaps(pos, s, 0)).toBe(true);
  });

  it('places new parent above existing children', () => {
    const s = sizes('parent', 'child');
    const prev = new Map([['child', { x: 100, y: 200 }]]);
    // parent → child: parent should be placed ABOVE child
    const pos = placeNewNodes(['parent', 'child'], s, [edge('parent', 'child')], prev, defaultOpts);
    expect(pos.get('parent')!.y).toBeLessThan(pos.get('child')!.y);
  });
});

// ── Dagre fresh layout (centering) ───────────────────────────────

describe('dagre fresh layout', () => {
  function center(pos: Map<string, { x: number; y: number }>, id: string, s: Map<string, { width: number; height: number }>): number {
    return pos.get(id)!.x + (s.get(id)?.width ?? 100) / 2;
  }

  it('parent centered over children', () => {
    const s = sizes('a', 'b', 'c');
    const edges = [edge('a', 'b'), edge('a', 'c')];
    const { positions } = layoutFlat(s, edges, new Map(), defaultOpts);
    const aC = center(positions, 'a', s);
    const childMid = (center(positions, 'b', s) + center(positions, 'c', s)) / 2;
    expect(Math.abs(aC - childMid)).toBeLessThan(5);
  });

  it('subtrees stay grouped: C directly above G', () => {
    // A→{B,C}, B→{D,E,F}, C→G
    const s = sizes('a', 'b', 'c', 'd', 'e', 'f', 'g');
    const edges = [
      edge('a', 'b'), edge('a', 'c'),
      edge('b', 'd'), edge('b', 'e'), edge('b', 'f'),
      edge('c', 'g'),
    ];
    const { positions } = layoutFlat(s, edges, new Map(), defaultOpts);
    expect(Math.abs(center(positions, 'c', s) - center(positions, 'g', s))).toBeLessThan(5);
    expect(noOverlaps(positions, s)).toBe(true);
  });

  it('no overlaps in complex graph', () => {
    const s = sizes('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
    const edges = [
      edge('a', 'b'), edge('a', 'c'),
      edge('b', 'd'), edge('d', 'e'), edge('d', 'f'), edge('d', 'g'),
      edge('c', 'h'),
    ];
    const { positions } = layoutFlat(s, edges, new Map(), defaultOpts);
    expect(noOverlaps(positions, s)).toBe(true);
  });
});

// ── Connected Components ─────────────────────────────────────────

describe('findComponents', () => {
  it('finds separate components', () => {
    const comps = findComponents(['a', 'b', 'c', 'd'], [edge('a', 'b'), edge('c', 'd')]);
    expect(comps.length).toBe(2);
    expect(comps[0].length).toBe(2);
    expect(comps[1].length).toBe(2);
  });

  it('merges connected nodes', () => {
    const comps = findComponents(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]);
    expect(comps.length).toBe(1);
    expect(comps[0].length).toBe(3);
  });

  it('handles isolated nodes', () => {
    const comps = findComponents(['a', 'b'], []);
    expect(comps.length).toBe(2);
  });
});

// ── layoutFlat (full pipeline) ───────────────────────────────────

describe('layoutFlat', () => {
  it('handles empty graph', () => {
    const { positions } = layoutFlat(new Map(), [], new Map(), defaultOpts);
    expect(positions.size).toBe(0);
  });

  it('handles single node', () => {
    const s = sizes('a');
    const { positions } = layoutFlat(s, [], new Map(), defaultOpts);
    expect(positions.size).toBe(1);
    expect(positions.has('a')).toBe(true);
  });

  it('ignores edges referencing non-existent nodes', () => {
    const s = sizes('a', 'b');
    const { positions } = layoutFlat(s, [edge('a', 'b'), edge('a', 'ghost')], new Map(), defaultOpts);
    expect(positions.size).toBe(2);
    expect(noOverlaps(positions, s)).toBe(true);
  });

  it('lays out a simple graph with no overlaps', () => {
    const s = sizes('a', 'b', 'c');
    const edges = [edge('a', 'b'), edge('a', 'c')];
    const { positions } = layoutFlat(s, edges, new Map(), defaultOpts);
    expect(positions.size).toBe(3);
    expect(noOverlaps(positions, s)).toBe(true);
    // a should be above b and c
    expect(positions.get('a')!.y).toBeLessThan(positions.get('b')!.y);
    expect(positions.get('a')!.y).toBeLessThan(positions.get('c')!.y);
  });

  it('arranges disconnected components without overlap', () => {
    const s = sizes('a', 'b', 'c', 'd');
    const edges = [edge('a', 'b'), edge('c', 'd')];
    const { positions } = layoutFlat(s, edges, new Map(), defaultOpts);
    expect(positions.size).toBe(4);
    expect(noOverlaps(positions, s)).toBe(true);
  });

  it('supports RIGHT direction', () => {
    const s = sizes('a', 'b');
    const edges = [edge('a', 'b')];
    const { positions } = layoutFlat(s, edges, new Map(), { ...defaultOpts, direction: 'RIGHT' });
    // In RIGHT mode, b should be to the right of a
    expect(positions.get('b')!.x).toBeGreaterThan(positions.get('a')!.x);
  });

  it('preserves positions for pinned nodes', () => {
    const s = sizes('a', 'b', 'c');
    const edges = [edge('a', 'b')];
    const prev = new Map([
      ['a', { x: 50, y: 0 }],
      ['b', { x: 50, y: 90 }],
    ]);
    const { positions } = layoutFlat(s, edges, prev, defaultOpts);
    // c is new, a and b should keep their X
    expect(positions.get('a')!.x).toBe(50);
    expect(positions.get('b')!.x).toBe(50);
  });
});

// ── Hierarchy ────────────────────────────────────────────────────

describe('hierarchy', () => {
  it('computeNestingDepth returns correct depths', () => {
    const h: HierarchyInfo = {
      childToParent: new Map([['b', 'a'], ['c', 'b']]),
      parentToChildren: new Map([['a', new Set(['b'])], ['b', new Set(['c'])]]),
    };
    expect(computeNestingDepth('a', h)).toBe(0);
    expect(computeNestingDepth('b', h)).toBe(1);
    expect(computeNestingDepth('c', h)).toBe(2);
  });

  it('computeGroupBounds computes correctly', () => {
    const positions = new Map([
      ['a', { x: 10, y: 20 }],
      ['b', { x: 50, y: 80 }],
    ]);
    const nodeSizes = new Map([
      ['a', { width: 100, height: 40 }],
      ['b', { width: 80, height: 40 }],
    ]);
    const bounds = computeGroupBounds(positions, nodeSizes, defaultPad);
    // minX=10, maxX=130, minY=20, maxY=120
    // shiftX = 10 - 10 = 0, shiftY = 40 - 20 = 20
    expect(bounds.shiftX).toBe(0);
    expect(bounds.shiftY).toBe(20);
    // width = (130-10) + 10 + 10 = 140, height = (120-20) + 40 + 10 = 150
    expect(bounds.width).toBe(140);
    expect(bounds.height).toBe(150);
  });

  it('decomposeAndLayout sizes groups correctly', () => {
    const h: HierarchyInfo = {
      childToParent: new Map([['b', 'g'], ['c', 'g']]),
      parentToChildren: new Map([['g', new Set(['b', 'c'])]]),
    };
    const s = new Map<string, { width: number; height: number }>([
      ['g', { width: 100, height: 40 }],
      ['b', { width: 100, height: 40 }],
      ['c', { width: 100, height: 40 }],
    ]);
    const result = decomposeAndLayout(
      s, [], h, new Map(),
      { ...defaultOpts, groupPadding: defaultPad },
      layoutFlat,
    );
    expect(result.groupDimensions.has('g')).toBe(true);
    const dim = result.groupDimensions.get('g')!;
    expect(dim.width).toBeGreaterThan(0);
    expect(dim.height).toBeGreaterThan(0);
    // Children should have positions
    expect(result.positions.has('b')).toBe(true);
    expect(result.positions.has('c')).toBe(true);
    expect(result.positions.has('g')).toBe(true);
  });
});

// ── layoutGraph (public API) ─────────────────────────────────────

describe('layoutGraph', () => {
  it('works for flat graphs', () => {
    const result = layoutGraph({
      nodes: sizes('a', 'b', 'c'),
      edges: [edge('a', 'b'), edge('a', 'c')],
      hierarchy: { childToParent: new Map(), parentToChildren: new Map() },
      previousPositions: new Map(),
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    expect(result.positions.size).toBe(3);
    expect(result.groupDimensions.size).toBe(0);
  });

  it('works for hierarchical graphs', () => {
    const result = layoutGraph({
      nodes: new Map([
        ['g', { width: 100, height: 40 }],
        ['a', { width: 100, height: 40 }],
        ['b', { width: 100, height: 40 }],
      ]),
      edges: [edge('a', 'b')],
      hierarchy: {
        childToParent: new Map([['a', 'g'], ['b', 'g']]),
        parentToChildren: new Map([['g', new Set(['a', 'b'])]]),
      },
      previousPositions: new Map(),
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    expect(result.positions.size).toBe(3);
    expect(result.groupDimensions.has('g')).toBe(true);
  });

  it('incremental: existing nodes keep their X and Y position', () => {
    const s = sizes('a', 'b');
    const prev = new Map([['a', { x: 100, y: 55 }]]);
    const result = layoutGraph({
      nodes: s,
      edges: [edge('a', 'b')],
      hierarchy: { childToParent: new Map(), parentToChildren: new Map() },
      previousPositions: prev,
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    expect(result.positions.get('a')!.x).toBe(100);
    expect(result.positions.get('a')!.y).toBe(55);
  });

  it('produces deterministic output with independent inputs', () => {
    const makeInput = () => ({
      nodes: sizes('c', 'a', 'b'),
      edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'c')],
      hierarchy: { childToParent: new Map(), parentToChildren: new Map() },
      previousPositions: new Map(),
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    const r1 = layoutGraph(makeInput());
    const r2 = layoutGraph(makeInput());
    expect(Array.from(r1.positions)).toEqual(Array.from(r2.positions));
  });

  it('3-node all-cycle produces valid DAG', () => {
    const result = layoutGraph({
      nodes: sizes('a', 'b', 'c'),
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a', 'back')],
      hierarchy: { childToParent: new Map(), parentToChildren: new Map() },
      previousPositions: new Map(),
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    expect(result.positions.size).toBe(3);
    expect(result.backEdgeIds.size).toBeGreaterThan(0);
  });

  it('empty-children group does not crash', () => {
    const result = layoutGraph({
      nodes: new Map([['g', { width: 100, height: 40 }], ['a', { width: 100, height: 40 }]]),
      edges: [],
      hierarchy: {
        childToParent: new Map(),
        parentToChildren: new Map([['g', new Set<string>()]]),
      },
      previousPositions: new Map(),
      options: { ...defaultOpts, groupPadding: defaultPad },
    });
    expect(result.positions.size).toBe(2);
  });
});
