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

/**
 * A node of the skeleton graph: a symbol (in one containment context) and
 * the counts needed to draw it. Instances are NOT here — they are display
 * detail fetched per node when the hover opens.
 */
export interface Node {
    /** Display id: the symbol id, or `{symbol}\0{context}` when split. */
    id: string;
    /**
     * Raw symbol id(s) this node covers — the key the detail endpoints take.
     * One for a server-split node; several after same-name merging.
     */
    symbol_ids: Array<string>;
    label: string;
    symbol_type?: string;
    /** Container symbol (module/directory/file) — from the SYMBOL type. */
    is_directory: boolean;
    /** Instances in the RESULT (the node badge), not the symbol's total. */
    instance_count: number;
    /**
     * Containment context this node was split into: the parent SYMBOL id, or
     * undefined at top level. Scopes the node's instance listing.
     */
    parent_symbol?: string;
    query_statements?: Array<QueryStatement>;
    color?: string;
}

/**
 * One edge of the graph: a (from, to) SYMBOL pair plus how many call sites it
 * has.  Individual call sites are display detail, not structure — they are
 * paged from `/v1/edge/{from}/{to}/occurrences` when the edge is opened.
 * `id` is computed client-side as `${from}-${to}`.
 */
export interface Edge {
    id: string;
    /** Display endpoints — rewritten by the split/merge transforms. */
    from: string;
    to: string;
    /**
     * The RAW symbol pair this edge came from, preserved verbatim through
     * every transform. `from`/`to` become split or merged node ids, but the
     * detail endpoint (`/v1/edge/{from}/{to}/occurrences`) is keyed by symbol.
     */
    from_symbol: string;
    to_symbol: string;
    occurrence_count: number;
    /**
     * Distinct files this pair's call sites live in. The server routes split
     * edges with it; kept on the wire for `detail=full` clients.
     */
    from_objects?: Array<string>;
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
    /**
     * Raw symbol ids whose implicit out-edge list the server capped
     * (assembly capping — the node set is complete, only the edge listing is
     * paged).  Keyed by SYMBOL, not node id: split and merged node ids
     * diverge from server ids, so membership is resolved per node through
     * its `symbol_ids`.
     */
    edges_truncated: Set<string>;
}

/**
 * The raw symbol ids of `node` whose out-edge list the server truncated.
 * Read straight off `symbol_ids`, which the server sets per node (one entry
 * for a split node) and merging unions — no id parsing anywhere.
 */
export function truncatedSymbolsForNode(node: Node, graph: Graph): Array<string> {
    if (graph.edges_truncated.size === 0) {
        return [];
    }
    return node.symbol_ids.filter((symbol) => graph.edges_truncated.has(symbol));
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
 * Merge nodes with the same label at the same effective nesting depth.
 * Two nodes merge when they share the same label AND the same effective parent
 * (the has_edge parent if it exists in the node set, otherwise null/root).
 */
export function mergeSameNameNodes(graph: Graph): Graph {
    const { childToParent } = buildHierarchy(graph.has_edges, graph.nodes);

    // Compute effective parent: parent from hierarchy if that parent is in graph.nodes, else null
    function effectiveParent(nodeId: string): string | null {
        const parent = childToParent.get(nodeId);
        return parent && graph.nodes.has(parent) ? parent : null;
    }

    // Group nodes by (label, effectiveParent)
    const groups = new Map<string, string[]>();
    graph.nodes.forEach((node, nodeId) => {
        const ep = effectiveParent(nodeId);
        const key = `${node.label}\0${ep ?? ''}`;
        let arr = groups.get(key);
        if (!arr) { arr = []; groups.set(key, arr); }
        arr.push(nodeId);
    });

    // Fast path: no group has >1 node
    let needsMerge = false;
    for (const ids of Array.from(groups.values())) {
        if (ids.length > 1) { needsMerge = true; break; }
    }
    if (!needsMerge) return graph;

    // Build idRemap and merged nodes
    const idRemap = new Map<string, string>();
    const newNodes = new Map<string, Node>();

    groups.forEach((ids) => {
        if (ids.length === 1) {
            newNodes.set(ids[0], graph.nodes.get(ids[0])!);
            return;
        }
        // Canonical = first ID lexicographically
        ids.sort();
        const canonicalId = ids[0];
        // Merging is a pure skeleton operation: union the symbols, sum the
        // counts, OR the container flag. No instances are involved.
        const mergedSymbolIds: string[] = [];
        const symbolIdsSeen = new Set<string>();
        let mergedInstanceCount = 0;
        let mergedIsDirectory = false;
        const mergedQueryStatements: QueryStatement[] = [];
        const qsKeys = new Set<string>();
        let color: string | undefined;

        for (const id of ids) {
            if (id !== canonicalId) idRemap.set(id, canonicalId);
            const node = graph.nodes.get(id)!;
            for (const symbol of node.symbol_ids) {
                if (!symbolIdsSeen.has(symbol)) {
                    symbolIdsSeen.add(symbol);
                    mergedSymbolIds.push(symbol);
                }
            }
            mergedInstanceCount += node.instance_count;
            mergedIsDirectory = mergedIsDirectory || node.is_directory;
            if (node.query_statements) {
                for (const qs of node.query_statements) {
                    const key = `${qs.start}:${qs.end}`;
                    if (!qsKeys.has(key)) {
                        qsKeys.add(key);
                        mergedQueryStatements.push(qs);
                    }
                }
            }
            if (!color && node.color) color = node.color;
        }

        const canonical = graph.nodes.get(canonicalId)!;
        newNodes.set(canonicalId, {
            id: canonicalId,
            label: canonical.label,
            symbol_ids: mergedSymbolIds,
            symbol_type: canonical.symbol_type,
            is_directory: mergedIsDirectory,
            instance_count: mergedInstanceCount,
            ...(canonical.parent_symbol ? { parent_symbol: canonical.parent_symbol } : {}),
            ...(mergedQueryStatements.length > 0 ? { query_statements: mergedQueryStatements } : {}),
            ...(color ? { color } : {}),
        });
    });

    // Remap ref edges
    const newEdges = new Map<string, Array<Edge>>();
    graph.edges.forEach((edgeArray, edgeId) => {
        const edge = edgeArray[0];
        if (!edge) return;
        const newFrom = idRemap.get(edge.from) ?? edge.from;
        const newTo = idRemap.get(edge.to) ?? edge.to;
        const newEdgeId = (newFrom !== edge.from || newTo !== edge.to)
            ? `${newFrom}-${newTo}`
            : edgeId;
        const remappedArray = edgeArray.map(e => ({
            ...e,
            from: idRemap.get(e.from) ?? e.from,
            to: idRemap.get(e.to) ?? e.to,
        }));
        const existing = newEdges.get(newEdgeId);
        if (existing) {
            existing.push(...remappedArray);
        } else {
            newEdges.set(newEdgeId, remappedArray);
        }
    });

    // Remap has_edges
    const hasEdgePairsSeen = new Set<string>();
    const newHasEdges: HasEdge[] = [];
    for (const he of graph.has_edges) {
        const newParent = idRemap.get(he.parent) ?? he.parent;
        const newChild = idRemap.get(he.child) ?? he.child;
        if (newParent === newChild) continue; // filter self-referential
        const pairKey = `${newParent}\0${newChild}`;
        if (hasEdgePairsSeen.has(pairKey)) continue;
        hasEdgePairsSeen.add(pairKey);
        newHasEdges.push({
            ...he,
            parent: newParent,
            child: newChild,
        });
    }

    return {
        nodes: newNodes,
        edges: newEdges,
        has_edges: newHasEdges,
        objects: graph.objects,
        edges_truncated: graph.edges_truncated,
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
