import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Node as FlowNode } from 'reactflow';
import type { Graph } from '../graph';
import type { GraphNodeData } from './use_graph_layout';
import { computeAbsolutePosition } from './use_graph_layout';

interface UseGraphSearchOptions {
  mergedGraph: Graph;
  nodesRef: React.RefObject<FlowNode<GraphNodeData>[]>;
  focusNode: (nodeId: string) => void;
}

export function useGraphSearch({ mergedGraph, nodesRef, focusNode }: UseGraphSearchOptions) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const prevMatchIdsRef = useRef<string>('');

  const matches = useMemo(() => {
    if (!query) return [];
    const lowerQuery = query.toLowerCase();
    const matchingIds: string[] = [];
    mergedGraph.nodes.forEach((node) => {
      if (node.label.toLowerCase().includes(lowerQuery)) {
        matchingIds.push(node.id);
      }
    });
    // Sort spatially by position (Y then X) for reading-order navigation
    const currentNodes = nodesRef.current ?? [];
    const matchingIdSet = new Set(matchingIds);
    const nodeMap = new Map(currentNodes.map((n) => [n.id, n]));
    const posMap = new Map<string, { x: number; y: number }>();
    for (const n of currentNodes) {
      if (matchingIdSet.has(n.id)) {
        posMap.set(n.id, computeAbsolutePosition(n, nodeMap));
      }
    }
    matchingIds.sort((a, b) => {
      const posA = posMap.get(a);
      const posB = posMap.get(b);
      if (!posA || !posB) return 0;
      if (posA.y !== posB.y) return posA.y - posB.y;
      return posA.x - posB.x;
    });
    return matchingIds;
  }, [mergedGraph, query, nodesRef]);

  // When matches change, clamp currentIndex and auto-focus first match
  useEffect(() => {
    const matchIds = matches.join(',');
    if (matchIds === prevMatchIdsRef.current) return;
    prevMatchIdsRef.current = matchIds;
    setCurrentIndex(0);
    if (matches.length > 0) {
      focusNode(matches[0]);
    }
  }, [matches, focusNode]);

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
