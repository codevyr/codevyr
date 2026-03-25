import { describe, it, expect } from 'vitest';
import { buildHierarchy, filterRedundantEdges, Edge, HasEdge, Node } from './graph';

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
