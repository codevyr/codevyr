import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Node as FlowNode } from 'reactflow';
import type { Graph } from '../graph';
import type { GraphNodeData } from './use_graph_layout';
import { computeAbsolutePosition } from './use_graph_layout';

const EMPTY_MATCHES: string[] = [];

interface UseGraphSearchOptions {
  mergedGraph: Graph;
  nodes: FlowNode<GraphNodeData>[];
  focusNode: (nodeId: string) => void;
}

export function useGraphSearch({ mergedGraph, nodes, focusNode }: UseGraphSearchOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const prevMatchIdsRef = useRef<string>('');

  // Find matching node IDs by label (depends on graph data and query only)
  const matchingIds = useMemo(() => {
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    const ids: string[] = [];
    mergedGraph.nodes.forEach((node) => {
      if (node.label.toLowerCase().includes(lowerQuery)) {
        ids.push(node.id);
      }
    });
    return ids;
  }, [mergedGraph, query]);

  // Sort spatially by position (Y then X) for reading-order navigation.
  // Use a stable empty array to prevent downstream useMemo/useEffect cascades
  // when nodes change but there are no matches (avoids infinite re-render loop).
  const matches = useMemo(() => {
    if (matchingIds.length === 0) return EMPTY_MATCHES;
    const matchingIdSet = new Set(matchingIds);
    const nodeMap = new Map<string, FlowNode<GraphNodeData>>(nodes.map((n) => [n.id, n]));
    const posMap = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      if (matchingIdSet.has(n.id)) {
        posMap.set(n.id, computeAbsolutePosition(n, nodeMap));
      }
    }
    return [...matchingIds].sort((a, b) => {
      const posA = posMap.get(a);
      const posB = posMap.get(b);
      if (!posA || !posB) return 0;
      if (posA.y !== posB.y) return posA.y - posB.y;
      return posA.x - posB.x;
    });
  }, [matchingIds, nodes]);

  // Reset currentIndex when matches change (adjusting state during render)
  const matchIds = matches.join(',');
  const [prevMatchIds, setPrevMatchIds] = useState('');
  if (matchIds !== prevMatchIds) {
    setPrevMatchIds(matchIds);
    setCurrentIndex(0);
  }

  // Auto-focus first match when matches change (side effect)
  useEffect(() => {
    if (matchIds === prevMatchIdsRef.current) return;
    prevMatchIdsRef.current = matchIds;
    if (matches.length > 0) {
      focusNode(matches[0]);
    }
  }, [matchIds, matches, focusNode]);

  const currentMatchId = matches.length > 0 ? matches[currentIndex] ?? null : null;

  const matchSet = useMemo(() => new Set(matches), [matches]);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentIndex + 1) % matches.length;
    setCurrentIndex(nextIndex);
    focusNode(matches[nextIndex]);
  }, [matches, currentIndex, focusNode]);

  const goToPrevious = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prevIndex);
    focusNode(matches[prevIndex]);
  }, [matches, currentIndex, focusNode]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setCurrentIndex(0);
    prevMatchIdsRef.current = '';
  }, []);

  return {
    isOpen,
    open,
    close,
    query,
    setQuery,
    matches,
    currentIndex,
    goToNext,
    goToPrevious,
    currentMatchId,
    matchSet,
  };
}
