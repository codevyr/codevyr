import cytoscape from 'cytoscape';

type CleanupFn = () => void;

type TapHandler = (id: string) => void;

const WIN_KEY = {
  tapNode: '__asklTapNode',
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

  (window as any)[WIN_KEY.tapNode] = tapNode;

  return () => {
    if ((window as any)[WIN_KEY.tapNode] === tapNode) {
      delete (window as any)[WIN_KEY.tapNode];
    }
  };
}
