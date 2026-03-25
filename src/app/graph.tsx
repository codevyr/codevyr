import type { OffsetValue } from './lib/offsets';

export interface SymbolInstance {
    id: string;
    symbol: string;
    object_id: string;
    symbol_type: string;
    start_offset: OffsetValue;
    end_offset: OffsetValue;
}

export interface Node {
    id: string;
    label: string;
    symbol_instances: Array<SymbolInstance>;
    color?: string;
}

export interface Edge {
    id: string;
    from: string;
    to: string;
    from_object?: string;
    from_offset_start: OffsetValue;
    from_offset_end: OffsetValue;
}

export interface HasEdge {
    id: string;
    parent: string;
    child: string;
}

export interface GraphObject {
    path: string;
    project_id: string | null;
}

export interface Graph {
    nodes: Map<string, Node>;
    edges: Map<string, Array<Edge>>;
    has_edges: Array<HasEdge>;
    objects: Map<string, GraphObject>;
}

export interface HierarchyInfo {
    childToParent: Map<string, string>;
    parentToChildren: Map<string, Set<string>>;
}

export function buildHierarchy(hasEdges: Array<HasEdge>, nodes: Map<string, Node>): HierarchyInfo {
    const childToParent = new Map<string, string>();
    const parentToChildren = new Map<string, Set<string>>();
    hasEdges.forEach((he) => {
        if (!nodes.has(he.parent) || !nodes.has(he.child)) return;
        childToParent.set(he.child, he.parent);
        let children = parentToChildren.get(he.parent);
        if (!children) {
            children = new Set<string>();
            parentToChildren.set(he.parent, children);
        }
        children.add(he.child);
    });
    return { childToParent, parentToChildren };
}

/**
 * Remove edges that are redundant due to containment hierarchy.
 * An edge X→T is redundant if any descendant of X (via parentToChildren)
 * also has an edge to T.
 */
export function filterRedundantEdges(
    edges: Map<string, Array<Edge>>,
    parentToChildren: Map<string, Set<string>>,
    nodes: Map<string, Node>,
): Map<string, Array<Edge>> {
    // Build a Map<source, Set<target>> for O(1) pair lookups without string encoding
    const edgeTargetsBySource = new Map<string, Set<string>>();
    edges.forEach((edgeArray) => {
        const edge = edgeArray[0];
        if (edge && nodes.has(edge.from) && nodes.has(edge.to)) {
            let targets = edgeTargetsBySource.get(edge.from);
            if (!targets) {
                targets = new Set<string>();
                edgeTargetsBySource.set(edge.from, targets);
            }
            targets.add(edge.to);
        }
    });

    const descendantsCache = new Map<string, Set<string>>();
    function getDescendants(nodeId: string): Set<string> {
        const cached = descendantsCache.get(nodeId);
        if (cached) return cached;
        const result = new Set<string>();
        const stack = [nodeId];
        while (stack.length > 0) {
            const current = stack.pop()!;
            const children = parentToChildren.get(current);
            if (children) {
                children.forEach((child) => {
                    if (!result.has(child)) {
                        result.add(child);
                        stack.push(child);
                    }
                });
            }
        }
        descendantsCache.set(nodeId, result);
        return result;
    }

    function hasEdgeFromDescendant(fromNode: string, target: string): boolean {
        const descendants = getDescendants(fromNode);
        let found = false;
        descendants.forEach((desc) => {
            if (!found) {
                const targets = edgeTargetsBySource.get(desc);
                if (targets && targets.has(target)) {
                    found = true;
                }
            }
        });
        return found;
    }

    const result = new Map<string, Array<Edge>>();
    edges.forEach((edgeArray, edgeId) => {
        const edge = edgeArray[0];
        if (!edge) return;
        if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;

        if (!hasEdgeFromDescendant(edge.from, edge.to)) {
            result.set(edgeId, edgeArray);
        }
    });

    return result;
}
