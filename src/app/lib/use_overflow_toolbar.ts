import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarGroupConfig {
  id: string;
  priority: number; // lower = more important, collapses last
}

export interface OverflowState {
  mode: 'full' | 'compact';
  overflowIds: Set<string>;
  measureRef: React.RefObject<HTMLDivElement>;
  containerRef: React.RefObject<HTMLDivElement>;
}

const OVERFLOW_BUTTON_WIDTH = 40;

export function useOverflowToolbar(groups: ToolbarGroupConfig[]): OverflowState {
  const measureRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'full' | 'compact'>('full');
  const [overflowIds, setOverflowIds] = useState<Set<string>>(new Set());

  const compute = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const availableWidth = container.clientWidth;

    // Read full and compact widths from measurement container children
    const fullWidths = new Map<string, number>();
    const compactWidths = new Map<string, number>();

    for (const child of Array.from(measure.children) as HTMLElement[]) {
      const groupId = child.dataset.groupId;
      const variant = child.dataset.variant;
      if (!groupId || !variant) continue;
      const w = child.offsetWidth;
      if (variant === 'full') fullWidths.set(groupId, w);
      if (variant === 'compact') compactWidths.set(groupId, w);
    }

    // Try full mode
    let totalFull = 0;
    for (const g of groups) {
      totalFull += fullWidths.get(g.id) ?? 0;
    }
    if (totalFull <= availableWidth) {
      setMode('full');
      setOverflowIds(new Set());
      return;
    }

    // Try compact mode
    let totalCompact = 0;
    for (const g of groups) {
      totalCompact += compactWidths.get(g.id) ?? 0;
    }
    if (totalCompact <= availableWidth) {
      setMode('compact');
      setOverflowIds(new Set());
      return;
    }

    // Overflow: collapse groups by priority (highest number first)
    const sortedByPriority = [...groups].sort((a, b) => b.priority - a.priority);
    const hidden = new Set<string>();
    let remaining = totalCompact;

    for (const g of sortedByPriority) {
      if (remaining <= availableWidth - OVERFLOW_BUTTON_WIDTH) break;
      hidden.add(g.id);
      remaining -= compactWidths.get(g.id) ?? 0;
    }

    setMode('compact');
    setOverflowIds(hidden);
  }, [groups]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      compute();
    });
    observer.observe(container);

    // Initial computation — schedule to avoid synchronous setState in effect
    const rafId = requestAnimationFrame(compute);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [compute]);

  return { mode, overflowIds, measureRef, containerRef };
}
