import cytoscape from 'cytoscape';

type CleanupFn = () => void;

type TapHandler = (id: string) => void;

const WIN_KEY = {
  tapNode: '__asklTapNode',
  tapEdge: '__asklTapEdge',
};

export function setupGraphTestApis(cy: cytoscape.Core): CleanupFn | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return null;
  }

  const tapNode: TapHandler = (id: string) => {
    const element = cy.$id(id);
    if (element && element.length > 0) {
      element.trigger('tap');
    }
  };

  const tapEdge: TapHandler = (id: string) => {
    const element = cy.$id(id);
    if (element && element.length > 0) {
      element.trigger('tap');
    }
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
