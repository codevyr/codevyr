type CleanupFn = () => void;

type TapHandler = (id: string) => void;

const WIN_KEY = {
  tapNode: '__asklTapNode',
  tapEdge: '__asklTapEdge',
};

function fireClick(element: Element | null) {
  if (!element) {
    return;
  }
  const rect = element.getBoundingClientRect();
  const event = new MouseEvent('click', {
    bubbles: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  });
  element.dispatchEvent(event);
}

export function setupGraphTestApis(): CleanupFn | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return null;
  }

  const tapNode: TapHandler = (id: string) => {
    const element = document.querySelector(`[data-testid="graph-node-${id}"]`);
    fireClick(element);
  };

  const tapEdge: TapHandler = (id: string) => {
    const element = document.querySelector(`[data-testid="graph-edge-${id}"]`);
    fireClick(element);
  };

  (window as any)[WIN_KEY.tapNode] = tapNode;
  (window as any)[WIN_KEY.tapEdge] = tapEdge;

  return () => {
    if ((window as any)[WIN_KEY.tapNode] === tapNode) {
      delete (window as any)[WIN_KEY.tapNode];
    }
    if ((window as any)[WIN_KEY.tapEdge] === tapEdge) {
      delete (window as any)[WIN_KEY.tapEdge];
    }
  };
}
