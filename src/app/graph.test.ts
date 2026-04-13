import { describe, it, expect } from 'vitest';
import { alignToPreservedPositions, buildHierarchy, filterRedundantEdges, getPreservableNodeIds, mergeSameNameNodes, splitMultiParentNodes, Edge, FilteredEdgesResult, Graph, HasEdge, HierarchyInfo, Node, QueryStatement, SymbolInstance } from './graph';
import { adjustParentDimensions, measureGroupHeaderWidth, GROUP_PAD_BOTTOM, GROUP_PAD_LEFT, GROUP_PAD_RIGHT, GROUP_PAD_TOP } from './lib/graph_layout';
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

// --- splitMultiParentNodes tests ---

function makeInstance(id: string, objectId: string): SymbolInstance {
  return { id, symbol: id, object_id: objectId, symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 1 };
}

function makeNodeWithInstances(id: string, instances: SymbolInstance[]): Node {
  return { id, label: id, symbol_instances: instances };
}

function makeGraph(opts: {
  nodes: Node[];
  edges?: [string, string, string?][];  // [from, to, from_object?]
  hasEdges?: ([string, string] | [string, string, string, string])[];
}): Graph {
  const nodes = new Map(opts.nodes.map(n => [n.id, n]));
  const edges = new Map<string, Array<Edge>>();
  for (const [from, to, from_object] of (opts.edges ?? [])) {
    const id = `${from}-${to}`;
    const edge: Edge = { id, from, to, from_object, from_offset_start: 0, from_offset_end: 1 };
    edges.set(id, [edge]);
  }
  const has_edges: HasEdge[] = (opts.hasEdges ?? []).map((tuple) => {
    if (tuple.length === 4) {
      return makeHasEdge(tuple[0], tuple[1], tuple[2], tuple[3]);
    }
    return makeHasEdge(tuple[0], tuple[1]);
  });
  return { nodes, edges, has_edges, objects: new Map() };
}

describe('splitMultiParentNodes', () => {
  // Context key helpers for readability
  const ctx = (parent: string) => `contained-by:${parent}`;
  const ROOT = 'root';

  it('returns original graph when no nodes need splitting (no containment)', () => {
    const graph = makeGraph({
      nodes: [makeNode('A'), makeNode('B'), makeNode('C')],
      hasEdges: [['A', 'B']],
    });
    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph); // same reference — fast path
  });

  it('returns original graph when node has 0 parents', () => {
    const graph = makeGraph({
      nodes: [makeNode('A'), makeNode('B')],
      edges: [['A', 'B']],
    });
    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph);
  });

  it('returns original graph when all instances share the same context', () => {
    // Both b1 and b2 are contained by A → same context → no split
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj1'),
    ]);

    const graph = makeGraph({
      nodes: [parentA, childB],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['A', 'B', 'a1', 'b2']],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph);
  });

  it('splits node whose instances have different parent contexts', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),  // contained by A
      makeInstance('b2', 'obj2'),  // contained by C
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, childB],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).not.toBe(graph);

    // Original B should not exist
    expect(result.nodes.has('B')).toBe(false);

    // Split nodes should exist with context-key-based IDs
    const splitBA = result.nodes.get(`B\0${ctx('A')}`);
    const splitBC = result.nodes.get(`B\0${ctx('C')}`);
    expect(splitBA).toBeDefined();
    expect(splitBC).toBeDefined();
    expect(splitBA!.label).toBe('B');
    expect(splitBC!.label).toBe('B');
    expect(splitBA!.symbol_instances).toEqual([makeInstance('b1', 'obj1')]);
    expect(splitBC!.symbol_instances).toEqual([makeInstance('b2', 'obj2')]);

    // Has edges should point to split nodes
    const hasEdgePairs = result.has_edges.map(he => [he.parent, he.child]);
    expect(hasEdgePairs).toContainEqual(['A', `B\0${ctx('A')}`]);
    expect(hasEdgePairs).toContainEqual(['C', `B\0${ctx('C')}`]);
  });

  it('creates root split for uncontained instances alongside contained ones', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),   // contained by A
      makeInstance('b2', 'obj2'),   // contained by C
      makeInstance('b3', 'obj99'),  // not contained
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, childB],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
    });

    const result = splitMultiParentNodes(graph);
    const splitRoot = result.nodes.get(`B\0${ROOT}`);
    expect(splitRoot).toBeDefined();
    expect(splitRoot!.symbol_instances).toEqual([makeInstance('b3', 'obj99')]);
    // Root split should not have a has_edge (it's at root level)
    const rootHasEdges = result.has_edges.filter(he => he.child === `B\0${ROOT}`);
    expect(rootHasEdges).toHaveLength(0);
  });

  it('does not split parent when only some instances have children (partial containment)', () => {
    // A has a1 (leaf), a2 (parent of b2). Both are root → same context → no split on A.
    // B has b1 (root), b2 (contained by A) → different contexts → B splits.
    const nodeA = makeNodeWithInstances('A', [
      makeInstance('a1', 'obj1'),
      makeInstance('a2', 'obj2'),
    ]);
    const nodeB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);

    const graph = makeGraph({
      nodes: [nodeA, nodeB],
      hasEdges: [['A', 'B', 'a2', 'b2']],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).not.toBe(graph);

    // A should NOT split — both instances are root
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.get('A')).toBe(nodeA);

    // B should split: b1 is root, b2 is contained-by:A
    expect(result.nodes.has('B')).toBe(false);
    const splitBRoot = result.nodes.get(`B\0${ROOT}`);
    const splitBContained = result.nodes.get(`B\0${ctx('A')}`);
    expect(splitBRoot).toBeDefined();
    expect(splitBContained).toBeDefined();
    expect(splitBRoot!.symbol_instances).toEqual([makeInstance('b1', 'obj1')]);
    expect(splitBContained!.symbol_instances).toEqual([makeInstance('b2', 'obj2')]);

    // Has edge: A contains B(contained-by:A)
    const hasEdgePairs = result.has_edges.map(he => [he.parent, he.child]);
    expect(hasEdgePairs).toContainEqual(['A', `B\0${ctx('A')}`]);
    expect(hasEdgePairs).toHaveLength(1);
  });

  it('remaps "from" edge by from_object to correct split', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);
    const targetD = makeNode('D');

    const graph = makeGraph({
      nodes: [parentA, parentC, childB, targetD],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
      edges: [['B', 'D', 'obj1']],  // from_object matches A-context split's objects
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(1);
    expect(edgeEntries[0][0].from).toBe(`B\0${ctx('A')}`);
    expect(edgeEntries[0][0].to).toBe('D');
  });

  it('remaps "to" edge by shared parent context', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);
    // X is a child of A
    const nodeX = makeNodeWithInstances('X', [makeInstance('x1', 'obj1')]);

    const graph = makeGraph({
      nodes: [parentA, parentC, childB, nodeX],
      hasEdges: [
        ['A', 'B', 'a1', 'b1'],
        ['C', 'B', 'c1', 'b2'],
        ['A', 'X', 'a1', 'x1'],
      ],
      edges: [['X', 'B']],  // X is inside A, should route to B's A-context split
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(1);
    expect(edgeEntries[0][0].from).toBe('X');
    expect(edgeEntries[0][0].to).toBe(`B\0${ctx('A')}`);
  });

  it('duplicates "to" edge to all splits when no shared parent', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);
    const nodeX = makeNode('X');  // top-level, not related to A or C

    const graph = makeGraph({
      nodes: [parentA, parentC, childB, nodeX],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
      edges: [['X', 'B']],
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(2); // duplicated to both splits
    const targets = edgeEntries.map(e => e[0].to).sort();
    expect(targets).toEqual([`B\0${ctx('A')}`, `B\0${ctx('C')}`]);
  });

  it('duplicates self-loops to each split', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, childB],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
      edges: [['B', 'B']],
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(2);
    for (const entry of edgeEntries) {
      expect(entry[0].from).toBe(entry[0].to); // still a self-loop
    }
  });

  it('preserves non-split nodes unchanged', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const childB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, childB],
      hasEdges: [['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2']],
    });

    const result = splitMultiParentNodes(graph);
    expect(result.nodes.get('A')).toBe(parentA);
    expect(result.nodes.get('C')).toBe(parentC);
  });

  it('remaps has_edges when split node is also a parent (transitive nesting)', () => {
    // X contains A(a1), Y contains A(a2), A(a1) contains B(b1)
    // A splits because a1 is contained-by:X:group and a2 is contained-by:Y:leaf
    const nodeX = makeNodeWithInstances('X', [makeInstance('x1', 'obj1')]);
    const nodeY = makeNodeWithInstances('Y', [makeInstance('y1', 'obj2')]);
    const nodeA = makeNodeWithInstances('A', [
      makeInstance('a1', 'obj1'),
      makeInstance('a2', 'obj2'),
    ]);
    const nodeB = makeNodeWithInstances('B', [makeInstance('b1', 'obj1')]);

    const graph = makeGraph({
      nodes: [nodeX, nodeY, nodeA, nodeB],
      hasEdges: [
        ['X', 'A', 'x1', 'a1'],
        ['Y', 'A', 'y1', 'a2'],
        ['A', 'B', 'a1', 'b1'],
      ],
    });

    const result = splitMultiParentNodes(graph);

    // A should be split: a1 is contained-by:X, a2 is contained-by:Y
    expect(result.nodes.has('A')).toBe(false);
    expect(result.nodes.has(`A\0${ctx('X')}`)).toBe(true);
    expect(result.nodes.has(`A\0${ctx('Y')}`)).toBe(true);

    // B should still exist (single context: contained-by:A)
    expect(result.nodes.has('B')).toBe(true);

    // B's has_edge parent should be the A split that contains a1
    const bParentEdge = result.has_edges.find(he => he.child === 'B');
    expect(bParentEdge).toBeDefined();
    expect(bParentEdge!.parent).toBe(`A\0${ctx('X')}`);
  });

  it('remaps edges when both from and to are split by same parents', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const nodeB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);
    const nodeD = makeNodeWithInstances('D', [
      makeInstance('d1', 'obj1'),
      makeInstance('d2', 'obj2'),
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, nodeB, nodeD],
      hasEdges: [
        ['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2'],
        ['A', 'D', 'a1', 'd1'], ['C', 'D', 'c1', 'd2'],
      ],
      edges: [['B', 'D', 'obj1']],  // from_object pins to the A-context split
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(1);
    expect(edgeEntries[0][0].from).toBe(`B\0${ctx('A')}`);
    expect(edgeEntries[0][0].to).toBe(`D\0${ctx('A')}`);
  });

  it('remaps both-split edges to matching parent contexts without from_object', () => {
    const parentA = makeNodeWithInstances('A', [makeInstance('a1', 'obj1')]);
    const parentC = makeNodeWithInstances('C', [makeInstance('c1', 'obj2')]);
    const nodeB = makeNodeWithInstances('B', [
      makeInstance('b1', 'obj1'),
      makeInstance('b2', 'obj2'),
    ]);
    const nodeD = makeNodeWithInstances('D', [
      makeInstance('d1', 'obj1'),
      makeInstance('d2', 'obj2'),
    ]);

    const graph = makeGraph({
      nodes: [parentA, parentC, nodeB, nodeD],
      hasEdges: [
        ['A', 'B', 'a1', 'b1'], ['C', 'B', 'c1', 'b2'],
        ['A', 'D', 'a1', 'd1'], ['C', 'D', 'c1', 'd2'],
      ],
      edges: [['B', 'D']],  // no from_object
    });

    const result = splitMultiParentNodes(graph);
    const edgeEntries = Array.from(result.edges.values());
    expect(edgeEntries.length).toBe(2);
    const pairs = edgeEntries.map(e => [e[0].from, e[0].to]).sort();
    expect(pairs).toEqual([
      [`B\0${ctx('A')}`, `D\0${ctx('A')}`],
      [`B\0${ctx('C')}`, `D\0${ctx('C')}`],
    ]);
  });

  it('does NOT split parent with instances containing different children (same containment)', () => {
    // Directory "host" has two instances, each containing a different file.
    // Both instances are at root → same context → no split.
    // Both children should be nested under the single "host" node.
    const nodeHost = makeNodeWithInstances('host', [
      makeInstance('host1', 'obj1'),
      makeInstance('host2', 'obj2'),
    ]);
    const nodeMainC = makeNodeWithInstances('main.c', [makeInstance('mc1', 'obj1')]);
    const nodeInternalH = makeNodeWithInstances('internal.h', [makeInstance('ih1', 'obj2')]);

    const graph = makeGraph({
      nodes: [nodeHost, nodeMainC, nodeInternalH],
      hasEdges: [
        ['host', 'main.c', 'host1', 'mc1'],
        ['host', 'internal.h', 'host2', 'ih1'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph); // same reference — no split needed
  });

  it('does NOT split parent instances that contain the same child symbols', () => {
    // main has two instances, both contain child B → same context → no split
    const nodeMain = makeNodeWithInstances('main', [
      makeInstance('main1', 'file1'),
      makeInstance('main2', 'file2'),
    ]);
    const nodeB = makeNodeWithInstances('B', [
      makeInstance('b1', 'file1'),
      makeInstance('b2', 'file2'),
    ]);

    const graph = makeGraph({
      nodes: [nodeMain, nodeB],
      hasEdges: [
        ['main', 'B', 'main1', 'b1'],
        ['main', 'B', 'main2', 'b2'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph); // same reference — no split needed
  });

  it('does not split directory with multiple files that have nested symbols (3-level nesting)', () => {
    // dir/
    //   file1.c  → contains func_a
    //   file2.c  → contains func_b
    // dir has 2 instances parenting different files, but both are root → no split on dir.
    const nodeDir = makeNodeWithInstances('dir', [
      makeInstance('dir1', 'dobj1'),
      makeInstance('dir2', 'dobj2'),
    ]);
    const nodeFile1 = makeNodeWithInstances('file1.c', [makeInstance('f1', 'fobj1')]);
    const nodeFile2 = makeNodeWithInstances('file2.c', [makeInstance('f2', 'fobj2')]);
    const nodeFuncA = makeNodeWithInstances('func_a', [makeInstance('fa1', 'faobj')]);
    const nodeFuncB = makeNodeWithInstances('func_b', [makeInstance('fb1', 'fbobj')]);

    const graph = makeGraph({
      nodes: [nodeDir, nodeFile1, nodeFile2, nodeFuncA, nodeFuncB],
      hasEdges: [
        ['dir', 'file1.c', 'dir1', 'f1'],
        ['dir', 'file2.c', 'dir2', 'f2'],
        ['file1.c', 'func_a', 'f1', 'fa1'],
        ['file2.c', 'func_b', 'f2', 'fb1'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).toBe(graph); // no split needed — all same containment contexts

    // All nodes should be preserved
    expect(result.nodes.get('dir')).toBe(nodeDir);
    expect(result.nodes.get('file1.c')).toBe(nodeFile1);
    expect(result.nodes.get('file2.c')).toBe(nodeFile2);
    expect(result.nodes.get('func_a')).toBe(nodeFuncA);
    expect(result.nodes.get('func_b')).toBe(nodeFuncB);
  });

  it('splits node that appears under two different parents even with same children', () => {
    // lib.c appears under both dir_a and dir_b → different containment → split
    const nodeDirA = makeNodeWithInstances('dir_a', [makeInstance('da1', 'obj1')]);
    const nodeDirB = makeNodeWithInstances('dir_b', [makeInstance('db1', 'obj2')]);
    const nodeLib = makeNodeWithInstances('lib.c', [
      makeInstance('lib1', 'obj1'),  // contained by dir_a
      makeInstance('lib2', 'obj2'),  // contained by dir_b
    ]);

    const graph = makeGraph({
      nodes: [nodeDirA, nodeDirB, nodeLib],
      hasEdges: [
        ['dir_a', 'lib.c', 'da1', 'lib1'],
        ['dir_b', 'lib.c', 'db1', 'lib2'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).not.toBe(graph);

    expect(result.nodes.has('lib.c')).toBe(false);
    const splitLibA = result.nodes.get(`lib.c\0${ctx('dir_a')}`);
    const splitLibB = result.nodes.get(`lib.c\0${ctx('dir_b')}`);
    expect(splitLibA).toBeDefined();
    expect(splitLibB).toBeDefined();
    expect(splitLibA!.symbol_instances).toEqual([makeInstance('lib1', 'obj1')]);
    expect(splitLibB!.symbol_instances).toEqual([makeInstance('lib2', 'obj2')]);
  });

  it('splits node with mix of root and contained instances, preserving children under both', () => {
    // func has 3 instances: func1 at root, func2 under file_a, func3 under file_b
    // func1 parents child_x, func2 parents child_y — children don't affect splitting
    const nodeFileA = makeNodeWithInstances('file_a', [makeInstance('fa1', 'obj1')]);
    const nodeFileB = makeNodeWithInstances('file_b', [makeInstance('fb1', 'obj2')]);
    const nodeFunc = makeNodeWithInstances('func', [
      makeInstance('func1', 'obj3'),  // root
      makeInstance('func2', 'obj1'),  // contained by file_a
      makeInstance('func3', 'obj2'),  // contained by file_b
    ]);
    const nodeChildX = makeNodeWithInstances('child_x', [makeInstance('cx1', 'obj3')]);
    const nodeChildY = makeNodeWithInstances('child_y', [makeInstance('cy1', 'obj1')]);

    const graph = makeGraph({
      nodes: [nodeFileA, nodeFileB, nodeFunc, nodeChildX, nodeChildY],
      hasEdges: [
        ['file_a', 'func', 'fa1', 'func2'],
        ['file_b', 'func', 'fb1', 'func3'],
        ['func', 'child_x', 'func1', 'cx1'],
        ['func', 'child_y', 'func2', 'cy1'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).not.toBe(graph);

    // func should split into 3: root, contained-by:file_a, contained-by:file_b
    expect(result.nodes.has('func')).toBe(false);
    expect(result.nodes.get(`func\0${ROOT}`)).toBeDefined();
    expect(result.nodes.get(`func\0${ctx('file_a')}`)).toBeDefined();
    expect(result.nodes.get(`func\0${ctx('file_b')}`)).toBeDefined();

    // child_x's has_edge should point to the root split of func
    const cxParent = result.has_edges.find(he => he.child === 'child_x');
    expect(cxParent).toBeDefined();
    expect(cxParent!.parent).toBe(`func\0${ROOT}`);

    // child_y's has_edge should point to the file_a split of func
    const cyParent = result.has_edges.find(he => he.child === 'child_y');
    expect(cyParent).toBeDefined();
    expect(cyParent!.parent).toBe(`func\0${ctx('file_a')}`);
  });
});

// --- adjustParentDimensions tests ---

function flowNodeSized(id: string, x: number, y: number, w: number, h: number): FlowNode {
  return { id, position: { x, y }, data: { label: id }, style: { width: w, height: h } } as FlowNode;
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
  function labeled(id: string, label: string, instances?: SymbolInstance[]): Node {
    return { id, label, symbol_instances: instances ?? [] };
  }

  function mergeGraph(opts: { nodes: Map<string, Node>; edges?: Map<string, Array<Edge>>; has_edges?: HasEdge[] }): Graph {
    return {
      nodes: opts.nodes,
      edges: opts.edges ?? new Map(),
      has_edges: opts.has_edges ?? [],
      objects: new Map(),
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

  it('merges two root-level nodes with same label — instances combined', () => {
    const instA = makeInstance('inst-a', 'obj1');
    const instB = makeInstance('inst-b', 'obj2');
    const graph = mergeGraph({
      nodes: new Map([
        ['A', labeled('A', 'main', [instA])],
        ['B', labeled('B', 'main', [instB])],
      ]),
    });
    const result = mergeSameNameNodes(graph);
    expect(result.nodes.size).toBe(1);
    // Canonical is first lexicographically
    const canonical = result.nodes.get('A')!;
    expect(canonical).toBeDefined();
    expect(canonical.label).toBe('main');
    expect(canonical.symbol_instances).toHaveLength(2);
    expect(canonical.symbol_instances).toContain(instA);
    expect(canonical.symbol_instances).toContain(instB);
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
        ['A', { id: 'A', label: 'main', symbol_instances: [], color: '#ff0000', query_statements: [qs1] }],
        ['B', { id: 'B', label: 'main', symbol_instances: [], query_statements: [qs2, qsDup] }],
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
