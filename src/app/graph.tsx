import type { Node as FlowNode } from 'reactflow';
import type { OffsetValue } from './lib/offsets';
import { parseOffset } from './lib/offsets';

export interface SymbolInstance {
    id: string;
    symbol: string;
    object_id: string;
    symbol_type: string;
    instance_type: string;
    start_offset: OffsetValue;
    end_offset: OffsetValue;
}

export function isDirectoryInstance(inst: SymbolInstance): boolean {
    return inst.instance_type === 'sentinel' || inst.instance_type === 'containment';
}

export function isSelfReference(inst: SymbolInstance): boolean {
    return parseOffset(inst.start_offset) === 1 && parseOffset(inst.end_offset) === 0;
}

export interface QueryStatement {
    start: number;
    end: number;
    text: string;
}

export interface Node {
    id: string;
    label: string;
    symbol_instances: Array<SymbolInstance>;
    query_statements?: Array<QueryStatement>;
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
    parent_instance: string;
    child_instance: string;
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

/**
 * Split nodes based on instance-level containment from has_edges.
 *
 * Each has_edge now carries parent_instance and child_instance IDs, enabling
 * precise per-instance grouping. A node is split when its instances fall into
 * different containment contexts (different parents, or some contained and some
 * not, or some acting as groups and some not).
 *
 * Split node IDs use `${nodeId}\0${contextKey}` (NUL separator avoids collisions).
 */
export function splitMultiParentNodes(graph: Graph): Graph {
    // 1. Build instance-level containment map from has_edges
    // childInstToParent: which parent instance contains this child instance
    const childInstToParent = new Map<string, { parentSymbol: string; parentInstance: string }>();

    for (const he of graph.has_edges) {
        if (!graph.nodes.has(he.parent) || !graph.nodes.has(he.child)) continue;
        childInstToParent.set(he.child_instance, {
            parentSymbol: he.parent,
            parentInstance: he.parent_instance,
        });
    }

    // 2. Classify each instance into a context key based on containment only.
    // Instances with different parents get different keys; instances with the
    // same parent (or all at root) share a key — regardless of which children
    // they contain.  This avoids needlessly splitting a directory node whose
    // instances parent different files.
    //
    // context = `contained-by:{parentSymbol}` | `root`

    // instanceToContext: instanceId → contextKey
    const instanceToContext = new Map<string, string>();

    // Track which nodes need splitting (have multiple context keys)
    const nodeContextKeys = new Map<string, Set<string>>(); // nodeId → set of context keys

    graph.nodes.forEach((node, nodeId) => {
        const contextKeys = new Set<string>();
        for (const inst of node.symbol_instances) {
            const parentInfo = childInstToParent.get(inst.id);
            const contextKey = parentInfo
                ? `contained-by:${parentInfo.parentSymbol}`
                : 'root';
            instanceToContext.set(inst.id, contextKey);
            contextKeys.add(contextKey);
        }
        nodeContextKeys.set(nodeId, contextKeys);
    });

    // 3. Fast path: no node has multiple context keys → return graph unchanged
    let needsSplit = false;
    for (const keys of Array.from(nodeContextKeys.values())) {
        if (keys.size > 1) { needsSplit = true; break; }
    }
    if (!needsSplit) return graph;

    // 4. Build split nodes, new has_edges, and remapping info
    const newNodes = new Map<string, Node>();
    // instanceId → splitNodeId (for edge remapping)
    const instanceToSplit = new Map<string, string>();
    // splitId → set of object_ids in that split (for edge remapping)
    const splitObjectIds = new Map<string, Set<string>>();
    // splitId → parentSymbol (for "to" edge routing)
    const splitParent = new Map<string, string>();
    // originalId → splitId[]
    const splitLookup = new Map<string, string[]>();

    function collectObjectIds(instances: SymbolInstance[]): Set<string> {
        const ids = new Set<string>();
        for (const inst of instances) ids.add(inst.object_id);
        return ids;
    }

    graph.nodes.forEach((node, nodeId) => {
        const contextKeys = nodeContextKeys.get(nodeId)!;

        if (contextKeys.size <= 1) {
            // No split needed — keep original node
            newNodes.set(nodeId, node);
            for (const inst of node.symbol_instances) {
                instanceToSplit.set(inst.id, nodeId);
            }
            return;
        }

        // Group instances by context key
        const groups = new Map<string, SymbolInstance[]>();
        for (const inst of node.symbol_instances) {
            const ctx = instanceToContext.get(inst.id)!;
            let arr = groups.get(ctx);
            if (!arr) {
                arr = [];
                groups.set(ctx, arr);
            }
            arr.push(inst);
        }

        const splits: string[] = [];
        groups.forEach((instances, contextKey) => {
            const splitId = `${nodeId}\0${contextKey}`;
            splits.push(splitId);
            newNodes.set(splitId, {
                id: splitId,
                label: node.label,
                symbol_instances: instances,
                query_statements: node.query_statements,
                color: node.color,
            });
            splitObjectIds.set(splitId, collectObjectIds(instances));
            for (const inst of instances) {
                instanceToSplit.set(inst.id, splitId);
            }
            // Record parent for containment routing
            const parentInfo = childInstToParent.get(instances[0].id);
            if (parentInfo) {
                splitParent.set(splitId, parentInfo.parentSymbol);
            }
        });
        splitLookup.set(nodeId, splits);
    });

    // 5. Create has_edges between split nodes using instanceToSplit lookup
    const hasEdgePairsSeen = new Set<string>();
    const newHasEdges: HasEdge[] = [];

    for (const he of graph.has_edges) {
        const parentSplitId = instanceToSplit.get(he.parent_instance);
        const childSplitId = instanceToSplit.get(he.child_instance);
        if (!parentSplitId || !childSplitId) continue;
        const pairKey = `${parentSplitId}\0${childSplitId}`;
        if (hasEdgePairsSeen.has(pairKey)) continue;
        hasEdgePairsSeen.add(pairKey);
        newHasEdges.push({
            id: `has-${parentSplitId}-${childSplitId}`,
            parent: parentSplitId,
            child: childSplitId,
            parent_instance: he.parent_instance,
            child_instance: he.child_instance,
        });
    }

    // 6. Remap ref edges using instanceToSplit and object_id matching
    // Build childToParent from newHasEdges for ancestor walking
    const newChildToParent = new Map<string, string>();
    for (const he of newHasEdges) {
        newChildToParent.set(he.child, he.parent);
    }

    function getAncestors(nodeId: string): Set<string> {
        const result = new Set<string>();
        let current = newChildToParent.get(nodeId);
        while (current && !result.has(current)) {
            result.add(current);
            current = newChildToParent.get(current);
        }
        return result;
    }

    const newEdges = new Map<string, Array<Edge>>();

    graph.edges.forEach((edgeArray, edgeId) => {
        const edge = edgeArray[0];
        if (!edge) return;

        const fromSplits = splitLookup.get(edge.from);
        const toSplits = splitLookup.get(edge.to);

        if (!fromSplits && !toSplits) {
            newEdges.set(edgeId, edgeArray);
            return;
        }

        // Self-loop on a split node: duplicate to each split
        if (edge.from === edge.to && fromSplits) {
            for (const splitId of fromSplits) {
                const newEdgeId = `${edgeId}\0${splitId}`;
                newEdges.set(newEdgeId, edgeArray.map(e => ({
                    ...e,
                    from: splitId,
                    to: splitId,
                })));
            }
            return;
        }

        if (fromSplits && !toSplits) {
            // "from" is split: match from_object to the split that contains it
            let matchedSplitId: string | undefined;
            if (edge.from_object) {
                for (const splitId of fromSplits) {
                    const objIds = splitObjectIds.get(splitId);
                    if (objIds && objIds.has(edge.from_object)) {
                        matchedSplitId = splitId;
                        break;
                    }
                }
            }
            if (!matchedSplitId) matchedSplitId = fromSplits[0];
            const newEdgeId = `${edgeId}\0${matchedSplitId}`;
            newEdges.set(newEdgeId, edgeArray.map(e => ({ ...e, from: matchedSplitId! })));
            return;
        }

        if (!fromSplits && toSplits) {
            // "to" is split: route to the split sharing containment parent with "from"
            const fromAncestors = getAncestors(edge.from);
            fromAncestors.add(edge.from);
            let matchedSplitId: string | undefined;
            for (const splitId of toSplits) {
                const pid = splitParent.get(splitId);
                if (pid && fromAncestors.has(pid)) {
                    matchedSplitId = splitId;
                    break;
                }
            }
            if (matchedSplitId) {
                const newEdgeId = `${edgeId}\0${matchedSplitId}`;
                newEdges.set(newEdgeId, edgeArray.map(e => ({ ...e, to: matchedSplitId! })));
            } else {
                for (const splitId of toSplits) {
                    const newEdgeId = `${edgeId}\0${splitId}`;
                    newEdges.set(newEdgeId, edgeArray.map(e => ({ ...e, to: splitId })));
                }
            }
            return;
        }

        // Both from and to are split
        if (fromSplits && toSplits) {
            let createdEdge = false;
            for (const fromSplitId of fromSplits) {
                const fromPid = splitParent.get(fromSplitId);
                let matchedToSplit: string | undefined;
                if (fromPid) {
                    for (const toSplitId of toSplits) {
                        const toPid = splitParent.get(toSplitId);
                        if (toPid === fromPid) {
                            matchedToSplit = toSplitId;
                            break;
                        }
                    }
                }
                if (!matchedToSplit) matchedToSplit = toSplits[0];

                if (edge.from_object) {
                    const objIds = splitObjectIds.get(fromSplitId);
                    if (!objIds || !objIds.has(edge.from_object)) continue;
                }

                const newEdgeId = `${edgeId}\0${fromSplitId}\0${matchedToSplit}`;
                newEdges.set(newEdgeId, edgeArray.map(e => ({
                    ...e,
                    from: fromSplitId,
                    to: matchedToSplit!,
                })));
                createdEdge = true;
            }
            // Fallback: if from_object didn't match any split, route from first split
            if (!createdEdge) {
                const matchedToSplit = toSplits[0];
                const newEdgeId = `${edgeId}\0${fromSplits[0]}\0${matchedToSplit}`;
                newEdges.set(newEdgeId, edgeArray.map(e => ({
                    ...e,
                    from: fromSplits[0],
                    to: matchedToSplit,
                })));
            }
            return;
        }
    });

    return {
        nodes: newNodes,
        edges: newEdges,
        has_edges: newHasEdges,
        objects: graph.objects,
    };
}

export function buildHierarchy(hasEdges: Array<HasEdge>, nodes: Map<string, Node>): HierarchyInfo {
    const childToParent = new Map<string, string>();
    const parentToChildren = new Map<string, Set<string>>();
    hasEdges.forEach((he) => {
        if (!nodes.has(he.parent) || !nodes.has(he.child)) return;
        // Skip edges that would create a cycle (child is already an ancestor of parent)
        let ancestor: string | undefined = he.parent;
        let wouldCycle = false;
        while (ancestor) {
            if (ancestor === he.child) {
                wouldCycle = true;
                break;
            }
            ancestor = childToParent.get(ancestor);
        }
        if (wouldCycle) return;
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
export interface FilteredEdgesResult {
    visible: Map<string, Array<Edge>>;
    /** Ref edges hidden because a has (containment) edge exists between the same nodes, keyed by the ref edge's target node ID. */
    hiddenByHas: Map<string, Array<Edge>>;
}

export function filterRedundantEdges(
    edges: Map<string, Array<Edge>>,
    parentToChildren: Map<string, Set<string>>,
    nodes: Map<string, Node>,
): FilteredEdgesResult {
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
        for (const desc of Array.from(descendants)) {
            const targets = edgeTargetsBySource.get(desc);
            if (targets && targets.has(target)) {
                return true;
            }
        }
        return false;
    }

    const result = new Map<string, Array<Edge>>();
    const hiddenByHas = new Map<string, Array<Edge>>();
    edges.forEach((edgeArray, edgeId) => {
        const edge = edgeArray[0];
        if (!edge) return;
        if (!nodes.has(edge.from) || !nodes.has(edge.to)) return;

        // Skip ref edges between nodes that already have an ancestor-descendant
        // containment relationship.  Collect them so they can be shown in the
        // target node's context menu.
        const fromDescendants = getDescendants(edge.from);
        const toDescendants = getDescendants(edge.to);
        if (fromDescendants.has(edge.to) || toDescendants.has(edge.from)) {
            const existing = hiddenByHas.get(edge.to);
            if (existing) {
                existing.push(...edgeArray);
            } else {
                hiddenByHas.set(edge.to, [...edgeArray]);
            }
            return;
        }

        if (!hasEdgeFromDescendant(edge.from, edge.to)) {
            result.set(edgeId, edgeArray);
        }
    });

    // Post-process: deduplicate hidden edges the same way visible edges are deduped.
    // If A→C and B→C are both hidden, and B is a descendant of A, drop A→C.
    hiddenByHas.forEach((edgeArray, targetId) => {
        const sources = new Set(edgeArray.map(e => e.from));
        const filtered = edgeArray.filter(e => {
            const descendants = getDescendants(e.from);
            for (const desc of Array.from(descendants)) {
                if (sources.has(desc)) return false;
            }
            return true;
        });
        hiddenByHas.set(targetId, filtered);
    });

    return { visible: result, hiddenByHas };
}
