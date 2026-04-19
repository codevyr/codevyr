/**
 * layout/index.ts — Public API for the graph layout engine.
 *
 * Detects whether the graph has hierarchy and delegates accordingly:
 * flat graphs go directly to the flat layout engine; hierarchical graphs
 * go through the nesting decomposer which calls it per level.
 */

import { layoutFlat } from './flat_layout';
import { decomposeAndLayout } from './hierarchy';
import type { GroupPadding, HierarchyInfo } from './hierarchy';
import type { EdgeDef } from './flat_layout';

// ── Public Types ──────────────────────────────────────────────────

export type { EdgeDef, FlatLayoutOptions } from './flat_layout';
export type { GroupPadding, HierarchyInfo } from './hierarchy';

export interface LayoutInput {
  nodes: Map<string, { width: number; height: number }>;
  edges: EdgeDef[];
  hierarchy: HierarchyInfo;
  previousPositions: Map<string, { x: number; y: number }>;
  options: {
    direction: 'DOWN' | 'RIGHT';
    layerSpacing: number;
    nodeSpacing: number;
    componentGap: number;
    groupPadding: GroupPadding;
  };
}

export interface LayoutResult {
  /** Positions relative to parent (or absolute if no parent). */
  positions: Map<string, { x: number; y: number }>;
  /** Computed dimensions for group nodes. */
  groupDimensions: Map<string, { width: number; height: number }>;
  /** Edge IDs identified as back-edges during DAG construction. */
  backEdgeIds: Set<string>;
}

// ── Entry Point ──────────────────────────────────────────────────

export function layoutGraph(input: LayoutInput): LayoutResult {
  const hasHierarchy = input.hierarchy.childToParent.size > 0;

  if (!hasHierarchy) {
    const result = layoutFlat(
      input.nodes,
      input.edges,
      input.previousPositions,
      {
        direction: input.options.direction,
        layerSpacing: input.options.layerSpacing,
        nodeSpacing: input.options.nodeSpacing,
        componentGap: input.options.componentGap,
      },
    );
    return {
      positions: result.positions,
      groupDimensions: new Map(),
      backEdgeIds: result.backEdgeIds,
    };
  }

  return decomposeAndLayout(
    input.nodes,
    input.edges,
    input.hierarchy,
    input.previousPositions,
    {
      direction: input.options.direction,
      layerSpacing: input.options.layerSpacing,
      nodeSpacing: input.options.nodeSpacing,
      componentGap: input.options.componentGap,
      groupPadding: input.options.groupPadding,
    },
    layoutFlat,
  );
}
