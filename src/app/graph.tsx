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

/**
 * Split nodes that have multiple parents (via has_edges) into separate visual
 * nodes — one per parent — each containing only the symbol instances relevant
 * to that container.  Returns a full Graph so all downstream code works unchanged.
 *
 * Split node IDs use `${nodeId}\0${parentId}` (NUL separator avoids collisions).
 * Instances with no matching parent get a `${nodeId}\0root` split.
 */
export function splitMultiParentNodes(graph: Graph): Graph {
    // 1. Build childToParents: Map<childId, Set<parentId>>
    const childToParents = new Map<string, Set<string>>();
    let hasMultiParent = false;
    for (const he of graph.has_edges) {
        if (!graph.nodes.has(he.parent) || !graph.nodes.has(he.child)) continue;
        let parents = childToParents.get(he.child);
        if (!parents) {
            parents = new Set<string>();
            childToParents.set(he.child, parents);
        }
        parents.add(he.parent);
        if (parents.size > 1) hasMultiParent = true;
    }

    // 2. Fast path: no multi-parent nodes → return graph unchanged
    if (!hasMultiParent) return graph;

    function collectObjectIds(instances: SymbolInstance[]): Set<string> {
        const ids = new Set<string>();
        for (const inst of instances) ids.add(inst.object_id);
        return ids;
    }

    // 3. Build split nodes, new has_edges, and remapping info
    const newNodes = new Map<string, Node>();
    const newHasEdges: HasEdge[] = [];
    // originalId → Map<parentId|"root", splitId>
    const splitNodeIds = new Map<string, Map<string, string>>();
    // splitId → set of object_ids in that split (for edge remapping)
    const splitObjectIds = new Map<string, Set<string>>();
    // splitId → parentId (for "to" edge routing)
    const splitParent = new Map<string, string>();

    // Collect parent object_ids once (lazy cache)
    const parentObjectIdSets = new Map<string, Set<string>>();
    function getParentObjectIds(parentId: string): Set<string> {
        let s = parentObjectIdSets.get(parentId);
        if (s) return s;
        const parentNode = graph.nodes.get(parentId);
        s = parentNode ? collectObjectIds(parentNode.symbol_instances) : new Set();
        parentObjectIdSets.set(parentId, s);
        return s;
    }

    function addSplitNode(splitId: string, node: Node, instances: SymbolInstance[], parentId?: string): void {
        newNodes.set(splitId, {
            id: splitId,
            label: node.label,
            symbol_instances: instances,
            color: node.color,
        });
        splitObjectIds.set(splitId, collectObjectIds(instances));
        if (parentId) splitParent.set(splitId, parentId);
    }

    graph.nodes.forEach((node, nodeId) => {
        const parents = childToParents.get(nodeId);
        if (!parents || parents.size <= 1) {
            newNodes.set(nodeId, node);
            return;
        }

        // Multi-parent node: partition instances
        const parentIdArray = Array.from(parents);
        const assignedInstances = new Map<string, SymbolInstance[]>();
        for (const pid of parentIdArray) {
            assignedInstances.set(pid, []);
        }
        const leftover: SymbolInstance[] = [];

        for (const inst of node.symbol_instances) {
            let matched = false;
            for (const pid of parentIdArray) {
                if (getParentObjectIds(pid).has(inst.object_id)) {
                    assignedInstances.get(pid)!.push(inst);
                    matched = true;
                    break;
                }
            }
            if (!matched) leftover.push(inst);
        }

        const splits = new Map<string, string>();
        splitNodeIds.set(nodeId, splits);

        for (const pid of parentIdArray) {
            const instances = assignedInstances.get(pid)!;
            if (instances.length === 0) continue;
            const splitId = `${nodeId}\0${pid}`;
            splits.set(pid, splitId);
            addSplitNode(splitId, node, instances, pid);
            newHasEdges.push({ id: `has-${pid}-${splitId}`, parent: pid, child: splitId });
        }

        if (leftover.length > 0) {
            const splitId = `${nodeId}\0root`;
            splits.set('root', splitId);
            addSplitNode(splitId, node, leftover);
        }
    });

    // Copy non-split has_edges, remapping parent if it was split.
    // Pre-compute child object_ids for nodes whose parent was split.
    const childObjectIdCache = new Map<string, Set<string>>();
    for (const he of graph.has_edges) {
        if (!graph.nodes.has(he.parent) || !graph.nodes.has(he.child)) continue;
        if (splitNodeIds.has(he.child)) continue; // already handled above
        const parentSplits = splitNodeIds.get(he.parent);
        if (!parentSplits) {
            newHasEdges.push(he);
            continue;
        }
        // Parent was split — find which split shares object_ids with the child
        let childObjIds = childObjectIdCache.get(he.child);
        if (!childObjIds) {
            const childNode = graph.nodes.get(he.child);
            childObjIds = childNode ? collectObjectIds(childNode.symbol_instances) : new Set();
            childObjectIdCache.set(he.child, childObjIds);
        }
        let remappedParent: string | undefined;
        parentSplits.forEach((splitId) => {
            if (remappedParent) return;
            const objIds = splitObjectIds.get(splitId);
            if (!objIds) return;
            objIds.forEach((oid) => {
                if (!remappedParent && childObjIds.has(oid)) {
                    remappedParent = splitId;
                }
            });
        });
        if (!remappedParent) {
            remappedParent = parentSplits.values().next().value;
        }
        if (remappedParent) {
            newHasEdges.push({ id: he.id, parent: remappedParent, child: he.child });
        }
    }

    // 4. Remap edges
    // Build lookup: originalId → splitId[] and parentChain helpers
    const splitLookup = new Map<string, string[]>();
    splitNodeIds.forEach((splits, origId) => {
        splitLookup.set(origId, Array.from(splits.values()));
    });

    // Build childToParent from newHasEdges for ancestor walking
    const newChildToParent = new Map<string, string>();
    for (const he of newHasEdges) {
        newChildToParent.set(he.child, he.parent);
    }

    function getAncestors(nodeId: string): Set<string> {
        const result = new Set<string>();
        let current = newChildToParent.get(nodeId);
        while (current) {
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
            // Neither end is split — copy unchanged
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
            // "from" is split: match from_object to the split whose parent has that object_id
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
            // "to" is split: route to the split that shares a parent context with "from"
            const fromAncestors = getAncestors(edge.from);
            fromAncestors.add(edge.from); // include self
            // Also check direct parent of from
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
                // No shared parent: duplicate to all splits
                for (const splitId of toSplits) {
                    const newEdgeId = `${edgeId}\0${splitId}`;
                    newEdges.set(newEdgeId, edgeArray.map(e => ({ ...e, to: splitId })));
                }
            }
            return;
        }

        // Both from and to are split
        if (fromSplits && toSplits) {
            for (const fromSplitId of fromSplits) {
                const fromPid = splitParent.get(fromSplitId);
                // Try to find a matching to-split in the same parent context
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

    return { visible: result, hiddenByHas };
}
