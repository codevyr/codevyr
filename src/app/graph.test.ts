import { describe, it, expect } from 'vitest';
import { alignToPreservedPositions, buildHierarchy, filterRedundantEdges, getPreservableNodeIds, Edge, HasEdge, HierarchyInfo, Node } from './graph';
import type { Node as FlowNode } from 'reactflow';

function makeNode(id: string): Node {
  return { id, label: id, symbol_instances: [] };
}

function makeEdge(from: string, to: string): Edge {
  return { id: `${from}-${to}`, from, to, from_offset_start: 0, from_offset_end: 1 };
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

function edgeIds(result: Map<string, Array<Edge>>): string[] {
  return Array.from(result.keys()).sort();
}

function makeHasEdge(parent: string, child: string): HasEdge {
  return { id: `has-${parent}-${child}`, parent, child };
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
});

describe('filterRedundantEdges', () => {
  it('returns all edges when there is no containment hierarchy', () => {
    const nodes = makeNodes('A', 'B', 'C');
    const edges = makeEdges(['A', 'C'], ['B', 'C']);
    const hierarchy = new Map<string, Set<string>>();

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
    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['B-A']);
  });

  it('skips edges referencing unknown nodes', () => {
    const nodes = makeNodes('A', 'B');
    const edges = makeEdges(['A', 'B'], ['A', 'UNKNOWN']);
    const hierarchy = new Map<string, Set<string>>();

    const result = filterRedundantEdges(edges, hierarchy, nodes);
    expect(edgeIds(result)).toEqual(['A-B']);
  });

  it('returns empty map for empty inputs', () => {
    const result = filterRedundantEdges(new Map(), new Map(), new Map());
    expect(result.size).toBe(0);
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
  const nodes = makeNodes(...allIds);
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
