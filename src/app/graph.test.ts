import { describe, it, expect } from 'vitest';
import { alignToPreservedPositions, buildHierarchy, filterRedundantEdges, getPreservableNodeIds, splitMultiParentNodes, Edge, FilteredEdgesResult, Graph, HasEdge, HierarchyInfo, Node, SymbolInstance } from './graph';
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
  return { id, symbol: id, object_id: objectId, symbol_type: 'Function', start_offset: 0, end_offset: 1 };
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
  const ctxLeaf = (parent: string) => `contained-by:${parent}:leaf`;
  const ctxChildren = (parent: string, ...children: string[]) => `contained-by:${parent}:${[...children].sort().join(',')}`;
  const ROOT_LEAF = 'root:leaf';
  const rootChildren = (...children: string[]) => `root:${[...children].sort().join(',')}`;

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
    const splitBA = result.nodes.get(`B\0${ctxLeaf('A')}`);
    const splitBC = result.nodes.get(`B\0${ctxLeaf('C')}`);
    expect(splitBA).toBeDefined();
    expect(splitBC).toBeDefined();
    expect(splitBA!.label).toBe('B');
    expect(splitBC!.label).toBe('B');
    expect(splitBA!.symbol_instances).toEqual([makeInstance('b1', 'obj1')]);
    expect(splitBC!.symbol_instances).toEqual([makeInstance('b2', 'obj2')]);

    // Has edges should point to split nodes
    const hasEdgePairs = result.has_edges.map(he => [he.parent, he.child]);
    expect(hasEdgePairs).toContainEqual(['A', `B\0${ctxLeaf('A')}`]);
    expect(hasEdgePairs).toContainEqual(['C', `B\0${ctxLeaf('C')}`]);
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
    const splitRoot = result.nodes.get(`B\0${ROOT_LEAF}`);
    expect(splitRoot).toBeDefined();
    expect(splitRoot!.symbol_instances).toEqual([makeInstance('b3', 'obj99')]);
    // Root split should not have a has_edge (it's at root level)
    const rootHasEdges = result.has_edges.filter(he => he.child === `B\0${ROOT_LEAF}`);
    expect(rootHasEdges).toHaveLength(0);
  });

  it('splits on partial containment with single parent (core use case)', () => {
    // A has a1, a2. B has b1, b2. Only a2 contains b2.
    // Result: a1 standalone, a2 { b2 }, b1 standalone
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

    // A should split: a1 is root:leaf, a2 is root:B (parents child B)
    expect(result.nodes.has('A')).toBe(false);
    const splitALeaf = result.nodes.get(`A\0${ROOT_LEAF}`);
    const splitAGroup = result.nodes.get(`A\0${rootChildren('B')}`);
    expect(splitALeaf).toBeDefined();
    expect(splitAGroup).toBeDefined();
    expect(splitALeaf!.symbol_instances).toEqual([makeInstance('a1', 'obj1')]);
    expect(splitAGroup!.symbol_instances).toEqual([makeInstance('a2', 'obj2')]);

    // B should split: b1 is root:leaf, b2 is contained-by:A:leaf
    expect(result.nodes.has('B')).toBe(false);
    const splitBRoot = result.nodes.get(`B\0${ROOT_LEAF}`);
    const splitBContained = result.nodes.get(`B\0${ctxLeaf('A')}`);
    expect(splitBRoot).toBeDefined();
    expect(splitBContained).toBeDefined();
    expect(splitBRoot!.symbol_instances).toEqual([makeInstance('b1', 'obj1')]);
    expect(splitBContained!.symbol_instances).toEqual([makeInstance('b2', 'obj2')]);

    // Has edge: A(root:B) contains B(contained-by:A:leaf)
    const hasEdgePairs = result.has_edges.map(he => [he.parent, he.child]);
    expect(hasEdgePairs).toContainEqual([`A\0${rootChildren('B')}`, `B\0${ctxLeaf('A')}`]);
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
    expect(edgeEntries[0][0].from).toBe(`B\0${ctxLeaf('A')}`);
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
    expect(edgeEntries[0][0].to).toBe(`B\0${ctxLeaf('A')}`);
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
    expect(targets).toEqual([`B\0${ctxLeaf('A')}`, `B\0${ctxLeaf('C')}`]);
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

    // A should be split: a1 is contained-by:X with children={B}, a2 is contained-by:Y:leaf
    expect(result.nodes.has('A')).toBe(false);
    expect(result.nodes.has(`A\0${ctxChildren('X', 'B')}`)).toBe(true);
    expect(result.nodes.has(`A\0${ctxLeaf('Y')}`)).toBe(true);

    // B should still exist (single context: contained-by:A)
    expect(result.nodes.has('B')).toBe(true);

    // B's has_edge parent should be the A split that contains a1
    const bParentEdge = result.has_edges.find(he => he.child === 'B');
    expect(bParentEdge).toBeDefined();
    expect(bParentEdge!.parent).toBe(`A\0${ctxChildren('X', 'B')}`);
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
    expect(edgeEntries[0][0].from).toBe(`B\0${ctxLeaf('A')}`);
    expect(edgeEntries[0][0].to).toBe(`D\0${ctxLeaf('A')}`);
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
      [`B\0${ctxLeaf('A')}`, `D\0${ctxLeaf('A')}`],
      [`B\0${ctxLeaf('C')}`, `D\0${ctxLeaf('C')}`],
    ]);
  });

  it('splits parent instances that contain different child symbols', () => {
    // main has two instances: main1 (file1) contains childX, main2 (file2) contains childY
    // Both are root:group but with DIFFERENT children → should split
    const nodeMain = makeNodeWithInstances('main', [
      makeInstance('main1', 'file1'),
      makeInstance('main2', 'file2'),
    ]);
    const nodeX = makeNodeWithInstances('X', [makeInstance('x1', 'file1')]);
    const nodeY = makeNodeWithInstances('Y', [makeInstance('y1', 'file2')]);

    const graph = makeGraph({
      nodes: [nodeMain, nodeX, nodeY],
      hasEdges: [
        ['main', 'X', 'main1', 'x1'],
        ['main', 'Y', 'main2', 'y1'],
      ],
    });

    const result = splitMultiParentNodes(graph);
    expect(result).not.toBe(graph);

    // main should split because main1 contains {X} and main2 contains {Y}
    expect(result.nodes.has('main')).toBe(false);
    const splitMain1 = result.nodes.get(`main\0${rootChildren('X')}`);
    const splitMain2 = result.nodes.get(`main\0${rootChildren('Y')}`);
    expect(splitMain1).toBeDefined();
    expect(splitMain2).toBeDefined();
    expect(splitMain1!.symbol_instances).toEqual([makeInstance('main1', 'file1')]);
    expect(splitMain2!.symbol_instances).toEqual([makeInstance('main2', 'file2')]);

    // Has edges should point to correct splits
    const hasEdgePairs = result.has_edges.map(he => [he.parent, he.child]);
    expect(hasEdgePairs).toContainEqual([`main\0${rootChildren('X')}`, 'X']);
    expect(hasEdgePairs).toContainEqual([`main\0${rootChildren('Y')}`, 'Y']);
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
});
