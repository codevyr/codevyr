import { describe, it, expect } from 'vitest';
import { alignToPreservedPositions, buildHierarchy, filterRedundantEdges, getPreservableNodeIds, mergeSameNameNodes, Edge, FilteredEdgesResult, Graph, HasEdge, HierarchyInfo, Node, QueryStatement, truncatedSymbolsForNode } from './graph';
import { adjustParentDimensions, measureGroupHeaderWidth, GROUP_PAD_BOTTOM, GROUP_PAD_LEFT, GROUP_PAD_RIGHT, GROUP_PAD_TOP } from './lib/graph_layout';
import type { Node as FlowNode } from 'reactflow';

function makeNode(id: string): Node {
  return { id, label: id, symbol_ids: [id], is_directory: false, instance_count: 0 };
}

function makeEdge(from: string, to: string): Edge {
  return {
    id: `${from}-${to}`,
    from,
    to,
    from_symbol: from,
    to_symbol: to,
    occurrence_count: 1,
    from_objects: [],
  };
}

function makeNodes(...ids: string[]): Map<string, Node> {
  return new Map(ids.map((id) => [id, makeNode(id)]));
}

function makeEdges(...pairs: [string, string][]): Map<string, Array<Edge>> {
  const m = new Map<string, Array<Edge>>();
  for (const [from, to] of pairs) {
    m.set(`${from}-${to}`, [makeEdge(from, to)]);
  }
  return m;
}

function makeHierarchy(parentChildPairs: [string, string][]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [parent, child] of parentChildPairs) {
    let children = m.get(parent);
    if (!children) {
      children = new Set<string>();
      m.set(parent, children);
    }
    children.add(child);
  }
  return m;
}

function edgeIds(result: FilteredEdgesResult): string[] {
  return Array.from(result.visible.keys()).sort();
}

function makeHasEdge(parent: string, child: string, parentInstance?: string, childInstance?: string): HasEdge {
  const pi = parentInstance ?? `${parent}-inst`;
  const ci = childInstance ?? `${child}-inst`;
  return { id: `has-${parent}-${child}-${pi}-${ci}`, parent, child, parent_instance: pi, child_instance: ci };
}

describe('buildHierarchy', () => {
  it('builds parent-child maps from has_edges', () => {
    const nodes = makeNodes('A', 'B', 'C');
    const hasEdges = [makeHasEdge('A', 'B'), makeHasEdge('B', 'C')];

    const { childToParent, parentToChildren } = buildHierarchy(hasEdges, nodes);

    expect(childToParent.get('B')).toBe('A');
    expect(childToParent.get('C')).toBe('B');
    expect(childToParent.has('A')).toBe(false);
    expect(Array.from(parentToChildren.get('A')!)).toEqual(['B']);
    expect(Array.from(parentToChildren.get('B')!)).toEqual(['C']);
    expect(parentToChildren.has('C')).toBe(false);
  });

  it('skips has_edges referencing unknown nodes', () => {
    const nodes = makeNodes('A', 'B');
    const hasEdges = [
      makeHasEdge('A', 'B'),
      makeHasEdge('A', 'UNKNOWN'),   // child not in graph
      makeHasEdge('UNKNOWN', 'B'),   // parent not in graph
    ];

    const { childToParent, parentToChildren } = buildHierarchy(hasEdges, nodes);

    expect(childToParent.size).toBe(1);
    expect(childToParent.get('B')).toBe('A');
    expect(Array.from(parentToChildren.get('A')!)).toEqual(['B']);
  });

  it('returns empty maps for empty inputs', () => {
    const { childToParent, parentToChildren } = buildHierarchy([], new Map());
    expect(childToParent.size).toBe(0);
    expect(parentToChildren.size).toBe(0);
  });

  it('breaks cycles in has_edges', () => {
    const nodes = makeNodes('A', 'B');
    const hasEdges = [makeHasEdge('A', 'B'), makeHasEdge('B', 'A')];

    const { childToParent, parentToChildren } = buildHierarchy(hasEdges, nodes);

    // First edge wins: A is parent of B. Second edge (B parent of A) is dropped.
    expect(childToParent.size).toBe(1);
    expect(childToParent.get('B')).toBe('A');
    expect(parentToChildren.get('A')?.has('B')).toBe(true);
    expect(parentToChildren.has('B')).toBe(false);
  });
});

describe('filterRedundantEdges', () => {
  it('returns all edges when there is no containment hierarchy', () => {
    const nodes = makeNodes('A', 'B', 'C');
    const edges = makeEdges(['A', 'C'], ['B', 'C']);
    const hierarchy = makeHierarchy([]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-C', 'B-C']);
  });

  it('filters ancestor edges in a linear chain A→B→C, all with edges to D', () => {
    const nodes = makeNodes('A', 'B', 'C', 'D');
    const edges = makeEdges(['A', 'D'], ['B', 'D'], ['C', 'D']);
    const hierarchy = makeHierarchy([['A', 'B'], ['B', 'C']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['C-D']);
  });

  it('keeps edges from independent branches', () => {
    // A contains B1 and B2; B1 contains C1, B2 contains C2
    // C1→D and C2→D exist; A→D, B1→D, B2→D are redundant
    const nodes = makeNodes('A', 'B1', 'B2', 'C1', 'C2', 'D');
    const edges = makeEdges(['A', 'D'], ['B1', 'D'], ['B2', 'D'], ['C1', 'D'], ['C2', 'D']);
    const hierarchy = makeHierarchy([['A', 'B1'], ['A', 'B2'], ['B1', 'C1'], ['B2', 'C2']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['C1-D', 'C2-D']);
  });

  it('keeps mid-level edge when no deeper descendant has the same target', () => {
    // A→B→C; B→D exists but C→D does not
    const nodes = makeNodes('A', 'B', 'C', 'D');
    const edges = makeEdges(['A', 'D'], ['B', 'D']);
    const hierarchy = makeHierarchy([['A', 'B'], ['B', 'C']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['B-D']);
  });

  it('keeps leaf-only edges alongside filtered ones', () => {
    // B2→E exists, no descendant of B2 has edge to E
    const nodes = makeNodes('A', 'B1', 'B2', 'C1', 'C2', 'D', 'E');
    const edges = makeEdges(['A', 'D'], ['B1', 'D'], ['B2', 'D'], ['C1', 'D'], ['C2', 'D'], ['B2', 'E']);
    const hierarchy = makeHierarchy([['A', 'B1'], ['A', 'B2'], ['B1', 'C1'], ['B2', 'C2']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['B2-E', 'C1-D', 'C2-D']);
  });

  it('handles self-loops', () => {
    const nodes = makeNodes('A', 'B');
    const edges = makeEdges(['A', 'A'], ['B', 'B']);
    const hierarchy = makeHierarchy([['A', 'B']]);

    // A→A is redundant because B (descendant of A) also has an edge to A? No — B→A doesn't exist, only B→B.
    // A→A: descendants of A are {B}. Does B have edge to A? No. Keep A→A.
    // B→B: descendants of B are {}. Keep B→B.
    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-A', 'B-B']);
  });

  it('filters self-loop on ancestor when descendant also self-loops to same target', () => {
    // A contains B; both A→A and B→A exist
    const nodes = makeNodes('A', 'B');
    const edges = makeEdges(['A', 'A'], ['B', 'A']);
    const hierarchy = makeHierarchy([['A', 'B']]);

    // A→A: descendants of A are {B}. Does B have edge to A? Yes (B→A). Filter A→A.
    // B→A: B is a child of A (has edge), so this ref is hidden by has-edge dedup.
    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual([]);
    // B→A goes into hiddenByHas keyed by edge.to = 'A'
    expect(result.hiddenByHas.get('A')!.map(e => e.id)).toEqual(['B-A']);
  });

  it('skips edges referencing unknown nodes', () => {
    const nodes = makeNodes('A', 'B');
    const edges = makeEdges(['A', 'B'], ['A', 'UNKNOWN']);
    const hierarchy = makeHierarchy([]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-B']);
  });

  it('returns empty map for empty inputs', () => {
    const result = filterRedundantEdges(new Map(), new Map(), new Map());
    expect(result.visible.size).toBe(0);
  });

  it('hides ref edges that duplicate has edges and puts them in hiddenByHas', () => {
    // A contains B (has edge). A→B ref edge should be hidden.
    const nodes = makeNodes('A', 'B', 'C');
    const edges = makeEdges(['A', 'B'], ['A', 'C']);
    const hierarchy = makeHierarchy([['A', 'B']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-C']);
    expect(result.hiddenByHas.has('B')).toBe(true);
    expect(result.hiddenByHas.get('B')!.map(e => e.id)).toEqual(['A-B']);
  });

  it('deduplicates hidden ref edges by descendant logic', () => {
    // A contains B, B contains C.  Both A→C and B→C ref edges exist.
    // B→C is more specific (B is a descendant of A), so A→C should be dropped.
    const nodes = makeNodes('A', 'B', 'C');
    const edges = makeEdges(['A', 'C'], ['B', 'C']);
    const hierarchy = makeHierarchy([['A', 'B'], ['B', 'C']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual([]);
    // Only B→C should remain in hiddenByHas, A→C is redundant
    expect(result.hiddenByHas.get('C')!.map(e => e.id)).toEqual(['B-C']);
  });

  it('hides ref edges between deeply nested ancestor-descendant pairs', () => {
    // A contains B, B contains C.  A→C ref edge should be hidden (grandparent).
    const nodes = makeNodes('A', 'B', 'C', 'D');
    const edges = makeEdges(['A', 'C'], ['A', 'D']);
    const hierarchy = makeHierarchy([['A', 'B'], ['B', 'C']]);

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-D']);
    expect(result.hiddenByHas.get('C')!.map(e => e.id)).toEqual(['A-C']);
  });
});

function emptyHierarchy(): HierarchyInfo {
  return { childToParent: new Map(), parentToChildren: new Map() };
}

function hierarchyFromPairs(pairs: [string, string][]): HierarchyInfo {
  const allIds = new Set<string>();
  const hasEdges: HasEdge[] = pairs.map(([parent, child]) => {
    allIds.add(parent);
    allIds.add(child);
    return makeHasEdge(parent, child);
  });
  const nodes = makeNodes(...Array.from(allIds));
  return buildHierarchy(hasEdges, nodes);
}

function positionsFor(...ids: string[]): Map<string, { x: number; y: number }> {
  return new Map(ids.map((id, i) => [id, { x: i * 100, y: i * 100 }]));
}

describe('getPreservableNodeIds', () => {
  it('all nodes stable, no hierarchy → all preservable', () => {
    const positions = positionsFor('A', 'B', 'C');
    const result = getPreservableNodeIds(emptyHierarchy(), emptyHierarchy(), positions);
    expect(result).toEqual(new Set(['A', 'B', 'C']));
  });

  it('all nodes stable, with hierarchy → all preservable', () => {
    const hierarchy = hierarchyFromPairs([['A', 'B']]);
    const positions = positionsFor('A', 'B', 'C');
    const result = getPreservableNodeIds(hierarchy, hierarchy, positions);
    expect(result).toEqual(new Set(['A', 'B', 'C']));
  });

  it('node becomes child (top-level → child of A) → NOT preservable', () => {
    const oldH = emptyHierarchy();
    const newH = hierarchyFromPairs([['A', 'B']]);
    const positions = positionsFor('A', 'B');
    const result = getPreservableNodeIds(oldH, newH, positions);
    // B changed parent (undefined → A), A gained child B
    expect(result.has('B')).toBe(false);
    expect(result.has('A')).toBe(false);
  });

  it('node becomes top-level (child of A → top-level) → NOT preservable', () => {
    const oldH = hierarchyFromPairs([['A', 'B']]);
    const newH = emptyHierarchy();
    const positions = positionsFor('A', 'B');
    const result = getPreservableNodeIds(oldH, newH, positions);
    expect(result.has('B')).toBe(false);
    expect(result.has('A')).toBe(false);
  });

  it('node changes parent (child of A → child of B) → NOT preservable', () => {
    const oldH = hierarchyFromPairs([['A', 'C']]);
    const newH = hierarchyFromPairs([['B', 'C']]);
    const positions = positionsFor('A', 'B', 'C');
    const result = getPreservableNodeIds(oldH, newH, positions);
    expect(result.has('C')).toBe(false);
    // A lost child, B gained child
    expect(result.has('A')).toBe(false);
    expect(result.has('B')).toBe(false);
  });

  it('new node (not in positions) → not in result set', () => {
    const hierarchy = hierarchyFromPairs([['A', 'B']]);
    const positions = positionsFor('A'); // B not in positions
    const result = getPreservableNodeIds(hierarchy, hierarchy, positions);
    expect(result.has('B')).toBe(false);
    expect(result.has('A')).toBe(true);
  });

  it('empty positions → empty result', () => {
    const hierarchy = hierarchyFromPairs([['A', 'B']]);
    const result = getPreservableNodeIds(hierarchy, hierarchy, new Map());
    expect(result.size).toBe(0);
  });

  it('parent gains a child → parent NOT preservable', () => {
    const oldH = hierarchyFromPairs([['A', 'B']]);
    const newH = hierarchyFromPairs([['A', 'B'], ['A', 'C']]);
    const positions = positionsFor('A', 'B', 'C');
    const result = getPreservableNodeIds(oldH, newH, positions);
    expect(result.has('A')).toBe(false); // children changed
    expect(result.has('B')).toBe(true);  // parent same, leaf
  });

  it('parent loses a child → parent NOT preservable', () => {
    const oldH = hierarchyFromPairs([['A', 'B'], ['A', 'C']]);
    const newH = hierarchyFromPairs([['A', 'B']]);
    const positions = positionsFor('A', 'B', 'C');
    const result = getPreservableNodeIds(oldH, newH, positions);
    expect(result.has('A')).toBe(false); // children changed
    expect(result.has('B')).toBe(true);  // still child of A
    expect(result.has('C')).toBe(false); // parent changed (A → undefined)
  });

  it('mixed scenario with stable and changed nodes', () => {
    // Old: A contains B,C; D is top-level
    // New: A contains B; D contains C (C moved, D gained child, A lost child)
    const oldH = hierarchyFromPairs([['A', 'B'], ['A', 'C']]);
    const newH = hierarchyFromPairs([['A', 'B'], ['D', 'C']]);
    const positions = positionsFor('A', 'B', 'C', 'D');
    const result = getPreservableNodeIds(oldH, newH, positions);
    expect(result.has('B')).toBe(true);  // same parent (A), still leaf
    expect(result.has('A')).toBe(false); // lost child C
    expect(result.has('C')).toBe(false); // parent changed A → D
    expect(result.has('D')).toBe(false); // gained child C
  });
});

function flowNode(id: string, x: number, y: number): FlowNode {
  return { id, position: { x, y }, data: {} } as FlowNode;
}

describe('alignToPreservedPositions', () => {
  it('shifts new root nodes by median delta of preserved root nodes', () => {
    const layouted = [
      flowNode('A', 0, 0),
      flowNode('B', 100, 0),
      flowNode('NEW', 50, 50),
    ];
    const preserved = new Map([
      ['A', { x: 200, y: 100 }],
      ['B', { x: 300, y: 100 }],
    ]);
    // Deltas: A=(200, 100), B=(200, 100) → median=(200, 100)
    const result = alignToPreservedPositions(layouted, preserved, emptyHierarchy());
    expect(result[0].position).toEqual({ x: 200, y: 100 }); // A preserved
    expect(result[1].position).toEqual({ x: 300, y: 100 }); // B preserved
    expect(result[2].position).toEqual({ x: 250, y: 150 }); // NEW shifted
  });

  it('uses median, not mean — robust to outliers', () => {
    const layouted = [
      flowNode('A', 0, 0),
      flowNode('B', 10, 0),
      flowNode('OUTLIER', 0, 0),
      flowNode('NEW', 5, 5),
    ];
    const preserved = new Map([
      ['A', { x: 100, y: 100 }],       // dx=100, dy=100
      ['B', { x: 110, y: 100 }],       // dx=100, dy=100
      ['OUTLIER', { x: 9000, y: 0 }],  // dx=9000, dy=0
    ]);
    // Median dx=100, median dy=100 (not skewed by OUTLIER)
    const result = alignToPreservedPositions(layouted, preserved, emptyHierarchy());
    expect(result[3].position).toEqual({ x: 105, y: 105 }); // NEW shifted by median
  });

  it('returns nodes unchanged when no preserved root nodes exist', () => {
    const layouted = [flowNode('A', 10, 20)];
    const preserved = new Map<string, { x: number; y: number }>();
    const result = alignToPreservedPositions(layouted, preserved, emptyHierarchy());
    expect(result[0].position).toEqual({ x: 10, y: 20 });
  });

  it('does not shift child nodes — they are relative to parent', () => {
    const hierarchy = hierarchyFromPairs([['G', 'C']]);
    const layouted = [
      flowNode('G', 0, 0),     // root, preserved
      flowNode('C', 10, 20),   // child of G
      flowNode('NEW', 50, 50), // root, new
    ];
    const preserved = new Map([
      ['G', { x: 100, y: 100 }],
    ]);
    // delta from G: (100, 100)
    const result = alignToPreservedPositions(layouted, preserved, hierarchy);
    expect(result[0].position).toEqual({ x: 100, y: 100 }); // G preserved
    expect(result[1].position).toEqual({ x: 10, y: 20 });   // C unchanged (child)
    expect(result[2].position).toEqual({ x: 150, y: 150 }); // NEW shifted
  });

  it('preserves all nodes when all are in preservedPositions', () => {
    const layouted = [
      flowNode('A', 0, 0),
      flowNode('B', 100, 0),
    ];
    const preserved = new Map([
      ['A', { x: 50, y: 50 }],
      ['B', { x: 150, y: 50 }],
    ]);
    const result = alignToPreservedPositions(layouted, preserved, emptyHierarchy());
    expect(result[0].position).toEqual({ x: 50, y: 50 });
    expect(result[1].position).toEqual({ x: 150, y: 50 });
  });

  it('handles single preserved node', () => {
    const layouted = [
      flowNode('A', 0, 0),
      flowNode('NEW', 80, 40),
    ];
    const preserved = new Map([['A', { x: 300, y: 200 }]]);
    const result = alignToPreservedPositions(layouted, preserved, emptyHierarchy());
    expect(result[0].position).toEqual({ x: 300, y: 200 });
    expect(result[1].position).toEqual({ x: 380, y: 240 });
  });
});

function flowNodeSized(id: string, x: number, y: number, w: number, h: number): FlowNode {
  return { id, position: { x, y }, data: { label: id }, style: { width: w, height: h } } as FlowNode;
}

/** A skeleton node: counts and flags, no instances. */
function makeSkeletonNode(
  id: string,
  opts: { symbolIds?: string[]; isDirectory?: boolean; instanceCount?: number } = {},
): Node {
  return {
    id,
    label: id,
    symbol_ids: opts.symbolIds ?? [id],
    is_directory: opts.isDirectory ?? false,
    instance_count: opts.instanceCount ?? 1,
  };
}

function makeGraph(opts: {
  nodes: Node[];
  edges?: [string, string][];
  hasEdges?: [string, string][];
}): Graph {
  const nodes = new Map(opts.nodes.map((n) => [n.id, n]));
  const edges = new Map<string, Array<Edge>>();
  for (const [from, to] of (opts.edges ?? [])) {
    edges.set(`${from}-${to}`, [makeEdge(from, to)]);
  }
  const has_edges: HasEdge[] = (opts.hasEdges ?? []).map(([p, c]) => makeHasEdge(p, c));
  return { nodes, edges, has_edges, objects: new Map(), edges_truncated: new Set<string>() };
}

describe('adjustParentDimensions', () => {
  it('computes parent dimensions from children bounding box', () => {
    const parent = flowNodeSized('A', 0, 0, 500, 500);
    const childB = flowNodeSized('B', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const childC = flowNodeSized('C', 100, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A'], ['C', 'A']]),
      parentToChildren: new Map([['A', new Set(['B', 'C'])]]),
    };
    const result = adjustParentDimensions([parent, childB, childC], hierarchy);
    const p = result.find((n) => n.id === 'A')!;
    // maxX = 100 + 80 = 180, width = 180 + PAD_RIGHT = 190
    expect(p.style!.width).toBe(180 + GROUP_PAD_RIGHT);
    // maxY = 40 + 30 = 70, height = 70 + PAD_BOTTOM = 80
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
  });

  it('parent grows when a child is added at a wider position', () => {
    const parent = flowNodeSized('A', 0, 0, 190, 80);
    const childB = flowNodeSized('B', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const childC = flowNodeSized('C', 100, GROUP_PAD_TOP, 80, 30);
    const childD = flowNodeSized('D', 200, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A'], ['C', 'A'], ['D', 'A']]),
      parentToChildren: new Map([['A', new Set(['B', 'C', 'D'])]]),
    };
    const result = adjustParentDimensions([parent, childB, childC, childD], hierarchy);
    const p = result.find((n) => n.id === 'A')!;
    // maxX = 200 + 80 = 280, width = 280 + PAD_RIGHT = 290
    expect(p.style!.width).toBe(280 + GROUP_PAD_RIGHT);
  });

  it('parent shrinks when a child is removed', () => {
    const parent = flowNodeSized('A', 0, 0, 500, 500);
    const childB = flowNodeSized('B', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A']]),
      parentToChildren: new Map([['A', new Set(['B'])]]),
    };
    const result = adjustParentDimensions([parent, childB], hierarchy);
    const p = result.find((n) => n.id === 'A')!;
    expect(p.style!.width).toBe(GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT);
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
  });

  it('multi-level nesting — bottom-up processing', () => {
    const grandparent = flowNodeSized('GP', 0, 0, 1000, 1000);
    const parent = flowNodeSized('P', GROUP_PAD_LEFT, GROUP_PAD_TOP, 500, 500);
    const child = flowNodeSized('C', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['C', 'P'], ['P', 'GP']]),
      parentToChildren: new Map([['P', new Set(['C'])], ['GP', new Set(['P'])]]),
    };
    const result = adjustParentDimensions([grandparent, parent, child], hierarchy);
    const p = result.find((n) => n.id === 'P')!;
    const gp = result.find((n) => n.id === 'GP')!;
    // P sized from C: width = PAD_LEFT + 80 + PAD_RIGHT = 100, height = PAD_TOP + 30 + PAD_BOTTOM = 80
    expect(p.style!.width).toBe(GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT);
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
    // GP sized from P (now 100x80): width = PAD_LEFT + 100 + PAD_RIGHT = 120, height = PAD_TOP + 80 + PAD_BOTTOM = 130
    expect(gp.style!.width).toBe(GROUP_PAD_LEFT + (GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT) + GROUP_PAD_RIGHT);
    expect(gp.style!.height).toBe(GROUP_PAD_TOP + (GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM) + GROUP_PAD_BOTTOM);
  });

  it('children below padding boundary — shift normalizes positions', () => {
    // Children at positions less than padding boundaries
    const parent = flowNodeSized('A', 100, 100, 500, 500);
    const childB = flowNodeSized('B', 5, 20, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A']]),
      parentToChildren: new Map([['A', new Set(['B'])]]),
    };
    const result = adjustParentDimensions([parent, childB], hierarchy);
    const p = result.find((n) => n.id === 'A')!;
    const b = result.find((n) => n.id === 'B')!;
    // shiftX = PAD_LEFT - 5 = 5, shiftY = PAD_TOP - 20 = 20
    // Parent position adjusts: x = 100 - 5 = 95, y = 100 - 20 = 80
    expect(p.position).toEqual({ x: 95, y: 80 });
    // Child shifts to padding boundary
    expect(b.position).toEqual({ x: GROUP_PAD_LEFT, y: GROUP_PAD_TOP });
    expect(p.style!.width).toBe(GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT);
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
  });

  it('idempotent — running twice produces same result', () => {
    const parent = flowNodeSized('A', 50, 50, 300, 300);
    const childB = flowNodeSized('B', 5, 20, 80, 30);
    const childC = flowNodeSized('C', 100, 20, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A'], ['C', 'A']]),
      parentToChildren: new Map([['A', new Set(['B', 'C'])]]),
    };
    const first = adjustParentDimensions([parent, childB, childC], hierarchy);
    const second = adjustParentDimensions(first, hierarchy);
    for (const node of first) {
      const match = second.find((n) => n.id === node.id)!;
      expect(match.position).toEqual(node.position);
      expect(match.style?.width).toBe(node.style?.width);
      expect(match.style?.height).toBe(node.style?.height);
    }
  });

  it('no parents — returns nodes unchanged', () => {
    const a = flowNode('A', 10, 20);
    const b = flowNode('B', 30, 40);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map(),
      parentToChildren: new Map(),
    };
    const result = adjustParentDimensions([a, b], hierarchy);
    expect(result[0].position).toEqual({ x: 10, y: 20 });
    expect(result[1].position).toEqual({ x: 30, y: 40 });
  });

  it('parent encompasses preserved and new children', () => {
    const parent = flowNodeSized('A', 0, 0, 200, 200);
    // "preserved" child at old position
    const childOld = flowNodeSized('B', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    // "new" child placed further out by layout
    const childNew = flowNodeSized('C', 200, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A'], ['C', 'A']]),
      parentToChildren: new Map([['A', new Set(['B', 'C'])]]),
    };
    const result = adjustParentDimensions([parent, childOld, childNew], hierarchy);
    const p = result.find((n) => n.id === 'A')!;
    // maxX = 200 + 80 = 280
    expect(p.style!.width).toBe(280 + GROUP_PAD_RIGHT);
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
  });

  it('parent width respects label minimum when children are narrow', () => {
    const longLabel = 'some_very_long_directory_path_name';
    const parent = {
      id: 'P', position: { x: 0, y: 0 },
      data: { label: longLabel }, style: { width: 500, height: 500 },
    } as FlowNode;
    // Single narrow child
    const child = flowNodeSized('C', GROUP_PAD_LEFT, GROUP_PAD_TOP, 30, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['C', 'P']]),
      parentToChildren: new Map([['P', new Set(['C'])]]),
    };
    const result = adjustParentDimensions([parent, child], hierarchy);
    const p = result.find((n) => n.id === 'P')!;
    const childrenWidth = GROUP_PAD_LEFT + 30 + GROUP_PAD_RIGHT;
    const labelMinWidth = measureGroupHeaderWidth(longLabel);
    // Label is wider than children → parent uses label width
    expect(labelMinWidth).toBeGreaterThan(childrenWidth);
    expect(p.style!.width).toBe(labelMinWidth);
  });

  it('multi-level nesting with measuredSizes uses computed size for intermediate parents', () => {
    const gp = flowNodeSized('GP', 0, 0, 1000, 1000);
    const p = flowNodeSized('P', GROUP_PAD_LEFT, GROUP_PAD_TOP, 500, 500);
    const c = flowNodeSized('C', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['C', 'P'], ['P', 'GP']]),
      parentToChildren: new Map([['P', new Set(['C'])], ['GP', new Set(['P'])]]),
    };
    // measuredSizes has stale entry for P (180x40) and correct entry for C (80x30)
    const measuredSizes = new Map([
      ['P', { width: 180, height: 40 }],
      ['C', { width: 80, height: 30 }],
    ]);
    const result = adjustParentDimensions([gp, p, c], hierarchy, measuredSizes);
    const gpResult = result.find((n) => n.id === 'GP')!;
    const pResult = result.find((n) => n.id === 'P')!;
    // P is resized first from C: width = PAD_LEFT + 80 + PAD_RIGHT = 100
    expect(pResult.style!.width).toBe(GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT);
    expect(pResult.style!.height).toBe(GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM);
    // GP must use P's *computed* size (100x80), NOT the stale measuredSizes entry (180x40)
    expect(gpResult.style!.width).toBe(GROUP_PAD_LEFT + (GROUP_PAD_LEFT + 80 + GROUP_PAD_RIGHT) + GROUP_PAD_RIGHT);
    expect(gpResult.style!.height).toBe(GROUP_PAD_TOP + (GROUP_PAD_TOP + 30 + GROUP_PAD_BOTTOM) + GROUP_PAD_BOTTOM);
  });

  it('uses measuredSizes when provided for child dimensions', () => {
    const parent = flowNodeSized('A', 0, 0, 500, 500);
    // Child has small style dimensions but measured is larger
    const child = flowNodeSized('B', GROUP_PAD_LEFT, GROUP_PAD_TOP, 80, 30);
    const hierarchy: HierarchyInfo = {
      childToParent: new Map([['B', 'A']]),
      parentToChildren: new Map([['A', new Set(['B'])]]),
    };
    const measuredSizes = new Map([['B', { width: 200, height: 50 }]]);
    const result = adjustParentDimensions([parent, child], hierarchy, measuredSizes);
    const p = result.find((n) => n.id === 'A')!;
    // Should use measured width 200 instead of style width 80
    expect(p.style!.width).toBe(GROUP_PAD_LEFT + 200 + GROUP_PAD_RIGHT);
    expect(p.style!.height).toBe(GROUP_PAD_TOP + 50 + GROUP_PAD_BOTTOM);
  });
});

describe('mergeSameNameNodes', () => {
  function labeled(
    id: string,
    label: string,
    opts: { symbolIds?: string[]; instanceCount?: number; isDirectory?: boolean } = {},
  ): Node {
    return {
      id,
      label,
      symbol_ids: opts.symbolIds ?? [id],
      is_directory: opts.isDirectory ?? false,
      instance_count: opts.instanceCount ?? 0,
    };
  }

  function mergeGraph(opts: { nodes: Map<string, Node>; edges?: Map<string, Array<Edge>>; has_edges?: HasEdge[] }): Graph {
    return {
      nodes: opts.nodes,
      edges: opts.edges ?? new Map(),
      has_edges: opts.has_edges ?? [],
      objects: new Map(),
      edges_truncated: new Set<string>(),
    };
  }
  it('returns same reference when no merge needed (unique labels)', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'alpha')],
        ['B', labeled('B', 'beta')],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    expect(result).toBe(graph);
  });

  it('merges two root-level nodes with same label — symbols unioned, counts summed', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'main', { symbolIds: ['s1'], instanceCount: 2 })],
        ['B', labeled('B', 'main', { symbolIds: ['s2'], instanceCount: 3, isDirectory: true })],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    expect(result.nodes.size).toBe(1);
    // Canonical is first lexicographically
    const canonical = result.nodes.get('A')!;
    expect(canonical.label).toBe('main');
    // Merging is a skeleton operation: union the symbols (the detail
    // endpoints are keyed by them), sum the counts, OR the container flag.
    expect(canonical.symbol_ids).toEqual(['s1', 's2']);
    expect(canonical.instance_count).toBe(5);
    expect(canonical.is_directory).toBe(true);
  });

  it('does not merge same label under different parents (both in node set)', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['P1', labeled('P1', 'parent1')],
        ['P2', labeled('P2', 'parent2')],
        ['A', labeled('A', 'main')],
        ['B', labeled('B', 'main')],
      ]),
      has_edges: [
        makeHasEdge('P1', 'A'),
        makeHasEdge('P2', 'B'),
      ],
    });
    const result = mergeSameNameNodes(graph);
    // Both A and B should still exist because they have different parents
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.has('B')).toBe(true);
    expect(result.nodes.size).toBe(4);
  });

  it('remaps ref edges after merge', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'main')],
        ['B', labeled('B', 'main')],
        ['C', labeled('C', 'other')],
      ]),
      edges: makeEdges(['C', 'B']),
    });
    const result = mergeSameNameNodes(graph);
    // B is remapped to A (canonical), so edge C→B becomes C→A
    expect(result.nodes.size).toBe(2);
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.has('C')).toBe(true);
    // The edge should now target A
    const allEdges = Array.from(result.edges.values()).flat();
    expect(allEdges.length).toBe(1);
    expect(allEdges[0].from).toBe('C');
    expect(allEdges[0].to).toBe('A');
  });

  it('remaps has_edges and deduplicates', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['P', labeled('P', 'parent')],
        ['A', labeled('A', 'child')],
        ['B', labeled('B', 'child')],
      ]),
      has_edges: [
        makeHasEdge('P', 'A'),
        makeHasEdge('P', 'B'),
      ],
    });
    const result = mergeSameNameNodes(graph);
    // A and B merge (same label, same parent P)
    expect(result.nodes.size).toBe(2);
    expect(result.has_edges).toHaveLength(1);
    expect(result.has_edges[0].parent).toBe('P');
    expect(result.has_edges[0].child).toBe('A');
  });

  it('does not merge nodes with parent-child has_edge between them', () => {
    // A→B has_edge makes B's effective parent A, not root — so they differ
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'main')],
        ['B', labeled('B', 'main')],
      ]),
      has_edges: [
        makeHasEdge('A', 'B'),
      ],
    });
    const result = mergeSameNameNodes(graph);
    // Different effective parents (A=root, B=A) → no merge
    expect(result.nodes.size).toBe(2);
    expect(result.has_edges).toHaveLength(1);
  });

  it('merges multiple groups simultaneously', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['A1', labeled('A1', 'alpha')],
        ['A2', labeled('A2', 'alpha')],
        ['B1', labeled('B1', 'beta')],
        ['B2', labeled('B2', 'beta')],
        ['C', labeled('C', 'gamma')],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    expect(result.nodes.size).toBe(3);
    expect(result.nodes.has('A1')).toBe(true);
    expect(result.nodes.has('B1')).toBe(true);
    expect(result.nodes.has('C')).toBe(true);
  });

  it('merges color and query_statements', () => {
    const qs1: QueryStatement = { start: 0, end: 10, text: 'query1' };
    const qs2: QueryStatement = { start: 20, end: 30, text: 'query2' };
    const qsDup: QueryStatement = { start: 0, end: 10, text: 'query1-dup' };
    const graph = mergeGraph({
      nodes: new Map([
        ['A', { ...labeled('A', 'main'), color: '#ff0000', query_statements: [qs1] }],
        ['B', { ...labeled('B', 'main'), query_statements: [qs2, qsDup] }],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    const node = result.nodes.get('A')!;
    expect(node.color).toBe('#ff0000');
    // qs1 and qs2 kept, qsDup deduplicated (same start+end as qs1)
    expect(node.query_statements).toHaveLength(2);
    expect(node.query_statements![0].start).toBe(0);
    expect(node.query_statements![1].start).toBe(20);
  });

  it('merges edges from multiple sources into same key', () => {
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'main')],
        ['B', labeled('B', 'main')],
        ['C', labeled('C', 'other')],
      ]),
      edges: new Map([
        ['C-A', [makeEdge('C', 'A')]],
        ['C-B', [makeEdge('C', 'B')]],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    // Both edges become C→A, should be merged into one key
    const edgeKey = 'C-A';
    const edgeArr = result.edges.get(edgeKey);
    expect(edgeArr).toBeDefined();
    expect(edgeArr!.length).toBe(2);
    expect(edgeArr!.every(e => e.from === 'C' && e.to === 'A')).toBe(true);
  });
});

describe('edges_truncated threading', () => {
  it('survives mergeSameNameNodes, which rebuilds the Graph literal', () => {
    const graph = makeGraph({
      nodes: [makeSkeletonNode('p'), makeSkeletonNode('a'), makeSkeletonNode('b')],
      hasEdges: [['p', 'a'], ['p', 'b']],
    });
    graph.edges_truncated = new Set(['a']);
    const merged = mergeSameNameNodes(graph);
    expect(merged.edges_truncated).toBe(graph.edges_truncated);
  });

  it('resolves a node\'s truncated symbols from symbol_ids', () => {
    // A split node carries its one raw symbol under a suffixed id; a merged
    // node carries several and reports exactly the truncated ones.
    const graph = makeGraph({ nodes: [] });
    graph.edges_truncated = new Set(['sym1', 'sym3']);

    const splitNode = makeSkeletonNode('sym1\u0000contained-by:parent', { symbolIds: ['sym1'] });
    expect(truncatedSymbolsForNode(splitNode, graph)).toEqual(['sym1']);

    const mergedNode = makeSkeletonNode('sym1', { symbolIds: ['sym1', 'sym2', 'sym3'] });
    expect(truncatedSymbolsForNode(mergedNode, graph)).toEqual(['sym1', 'sym3']);

    graph.edges_truncated = new Set();
    expect(truncatedSymbolsForNode(mergedNode, graph)).toEqual([]);
  });
});
