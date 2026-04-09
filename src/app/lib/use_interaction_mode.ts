import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InteractionMode } from '../graph_toolbar';

export function useInteractionMode() {
  const [mode, setMode] = useState<InteractionMode>('hand');
  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true);
      const el = e.target as HTMLElement;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.key === 'h' || e.key === 'H') setMode('hand');
      if (e.key === 'v' || e.key === 'V') setMode('select');
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false);
    };
    const blur = () => setCtrlHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const effectiveMode: InteractionMode = ctrlHeld ? 'select' : mode;
  const panOnDrag = useMemo(() => effectiveMode === 'hand' ? [0, 1] : [1], [effectiveMode]);
  const selectionOnDrag = effectiveMode === 'select';

  return { mode, setMode, effectiveMode, panOnDrag, selectionOnDrag };
}
