import type { Node as FlowNode } from 'reactflow';
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

/**
 * Returns the set of node IDs whose positions can be preserved when
 * transitioning from oldHierarchy to newHierarchy.
 *
 * A node is preservable when:
 * - It has an existing position in existingPositions
 * - Its parent hasn't changed (same parent or both top-level)
 * - Its children set hasn't changed (for parent/group nodes)
 */
export function getPreservableNodeIds(
    oldHierarchy: HierarchyInfo,
    newHierarchy: HierarchyInfo,
    existingPositions: Map<string, { x: number; y: number }>,
): Set<string> {
    const result = new Set<string>();

    existingPositions.forEach((_, nodeId) => {
        const oldParent = oldHierarchy.childToParent.get(nodeId);
        const newParent = newHierarchy.childToParent.get(nodeId);

        // Parent changed
        if (oldParent !== newParent) return;

        // Children changed (for group/parent nodes)
        const oldChildren = oldHierarchy.parentToChildren.get(nodeId);
        const newChildren = newHierarchy.parentToChildren.get(nodeId);

        if (!oldChildren && !newChildren) {
            result.add(nodeId);
            return;
        }

        if (!oldChildren || !newChildren) {
            return;
        }

        if (oldChildren.size !== newChildren.size) return;

        let allMatch = true;
        oldChildren.forEach((child) => {
            if (allMatch && !newChildren.has(child)) {
                allMatch = false;
            }
        });
        if (allMatch) result.add(nodeId);
    });

    return result;
}

/**
 * Align a fresh ELK layout to preserved node positions.
 * Computes a translation from ELK's coordinate space to the preserved
 * coordinate space using the median delta of root-level preserved nodes
 * (median is robust to outliers from disconnected subgraphs), then:
 * - Preserved nodes get their exact old positions (ELK-computed style
 *   for group dimensions is kept since ELK sizes groups from children)
 * - New/changed root-level nodes get ELK positions shifted by the translation
 * - Child nodes keep their ELK-relative positions (relative to parent)
 */
export function alignToPreservedPositions(
    layoutedNodes: FlowNode[],
    preservedPositions: Map<string, { x: number; y: number }>,
    hierarchy: HierarchyInfo,
): FlowNode[] {
    const dxs: number[] = [];
    const dys: number[] = [];
    layoutedNodes.forEach((node) => {
        if (!hierarchy.childToParent.has(node.id) && preservedPositions.has(node.id)) {
            const preserved = preservedPositions.get(node.id)!;
            dxs.push(preserved.x - node.position.x);
            dys.push(preserved.y - node.position.y);
        }
    });

    if (dxs.length === 0) return layoutedNodes;

    dxs.sort((a, b) => a - b);
    dys.sort((a, b) => a - b);
    const mid = Math.floor(dxs.length / 2);
    const dx = dxs.length % 2 === 1 ? dxs[mid] : (dxs[mid - 1] + dxs[mid]) / 2;
    const dy = dys.length % 2 === 1 ? dys[mid] : (dys[mid - 1] + dys[mid]) / 2;

    return layoutedNodes.map((node) => {
        if (preservedPositions.has(node.id)) {
            return { ...node, position: preservedPositions.get(node.id)! };
        }
        if (!hierarchy.childToParent.has(node.id)) {
            return {
                ...node,
                position: { x: node.position.x + dx, y: node.position.y + dy },
            };
        }
        return node;
    });
}

/**
 * Build a map of preserved positions from a set of preservable node IDs.
 */
export function buildPreservedPositionsMap(
    preservable: Set<string>,
    positions: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
    const result = new Map<string, { x: number; y: number }>();
    preservable.forEach((nodeId) => {
        const pos = positions.get(nodeId);
        if (pos) result.set(nodeId, pos);
    });
    return result;
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
