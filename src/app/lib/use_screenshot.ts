import { useCallback, useEffect, useRef } from 'react';
import { type MutableRefObject } from 'react';
import { type Node as FlowNode, type ReactFlowInstance } from 'reactflow';
import { type GraphNodeData, getNodeAbsolutePosition, getNodeSize } from './use_graph_layout';

export type ScreenshotMode = 'all-nodes' | 'visible-area';

const MAX_IMAGE_SIZE = 4096;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Resolve a computed style value, falling back if it contains an unresolved CSS variable. */
function resolveColor(computed: string, fallback: string): string {
  if (!computed || computed.startsWith('var(')) return fallback;
  return computed;
}

interface MarkerInfo {
  color: string;
  viewBox: string;
  refX: string;
  refY: string;
  markerWidth: string;
  markerHeight: string;
  markerUnits: string;
  orient: string;
  shapeSvg: string;
}

/** Find a marker element: first by ID from the marker-end attribute, then by class. */
function findMarkerEl(flowEl: HTMLElement, markerEndAttr: string): SVGMarkerElement | null {
  // Extract marker ID — handle both url(#id) and url('#id') formats.
  // The ["']? before #? handles ReactFlow's single-quoted URLs.
  const match = markerEndAttr.match(/url\(["']?#?(.+?)["']?\)$/);
  if (match) {
    try {
      const el = flowEl.querySelector(`#${CSS.escape(match[1])}`) as SVGMarkerElement | null;
      if (el) return el;
    } catch { /* CSS.escape or querySelector may fail on unusual IDs */ }
  }

  // Fallback: find by ReactFlow's marker class
  return flowEl.querySelector('marker.react-flow__arrowhead') as SVGMarkerElement | null;
}

/** Clone a marker element, reading its attributes and resolving computed styles. */
function cloneMarkerEl(markerEl: SVGMarkerElement, fallbackColor: string): MarkerInfo {
  const info: MarkerInfo = {
    color: fallbackColor,
    viewBox: markerEl.getAttribute('viewBox') || '-10 -10 20 20',
    refX: markerEl.getAttribute('refX') || '0',
    refY: markerEl.getAttribute('refY') || '0',
    markerWidth: markerEl.getAttribute('markerWidth') || '10',
    markerHeight: markerEl.getAttribute('markerHeight') || '10',
    markerUnits: markerEl.getAttribute('markerUnits') || 'strokeWidth',
    orient: markerEl.getAttribute('orient') || 'auto-start-reverse',
    shapeSvg: '',
  };

  const children: string[] = [];
  for (let i = 0; i < markerEl.children.length; i++) {
    const child = markerEl.children[i] as SVGElement;
    const tag = child.tagName.toLowerCase();
    const style = getComputedStyle(child);
    const fill = resolveColor(style.fill, fallbackColor);
    const stroke = resolveColor(style.stroke, 'none');
    const sw = style.strokeWidth || '';
    const extra = sw ? ` stroke-width="${escapeXml(sw)}"` : '';
    const lcap = child.getAttribute('stroke-linecap');
    const ljoin = child.getAttribute('stroke-linejoin');
    const capJoin = (lcap ? ` stroke-linecap="${escapeXml(lcap)}"` : '') + (ljoin ? ` stroke-linejoin="${escapeXml(ljoin)}"` : '');
    if (tag === 'path') {
      children.push(`<path d="${escapeXml(child.getAttribute('d') || '')}" fill="${fill}" stroke="${stroke}"${extra}${capJoin}/>`);
    } else if (tag === 'polyline' || tag === 'polygon') {
      children.push(`<${tag} points="${escapeXml(child.getAttribute('points') || '')}" fill="${fill}" stroke="${stroke}"${extra}${capJoin}/>`);
    }
    if (fill && fill !== 'none') info.color = fill;
  }
  info.shapeSvg = children.length > 0 ? children.join('') : `<polyline points="-5,-4 0,0 -5,4" fill="${fallbackColor}" stroke="${fallbackColor}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;

  return info;
}

/** Build a fallback MarkerInfo matching ReactFlow's ArrowClosed when DOM lookup fails. */
function fallbackMarker(color: string): MarkerInfo {
  return {
    color,
    viewBox: '-10 -10 20 20', refX: '0', refY: '0',
    markerWidth: '10', markerHeight: '10',
    markerUnits: 'strokeWidth', orient: 'auto-start-reverse',
    shapeSvg: `<polyline points="-5,-4 0,0 -5,4" fill="${color}" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
}

function buildGraphSvg(
  flowEl: HTMLElement,
  nodes: FlowNode<GraphNodeData>[],
  viewBox: { x: number; y: number; width: number; height: number },
  scale: number,
): string {
  const nodeRects: string[] = [];
  const edgePaths: string[] = [];

  // Render nodes
  for (const node of nodes) {
    const pos = getNodeAbsolutePosition(node);
    const size = getNodeSize(node);
    if (size.width === 0 || size.height === 0) continue;

    const domEl = flowEl.querySelector(`[data-testid="graph-node-${node.id.replace(/"/g, '\\"')}"]`) as HTMLElement | null;
    if (!domEl) continue;

    const style = getComputedStyle(domEl);
    const isGroup = node.data.isGroupNode === true;

    const bgColor = resolveColor(style.backgroundColor, isGroup ? 'rgba(219,234,254,0.3)' : '#bfdbfe');
    const borderColor = resolveColor(style.borderColor, '#93c5fd');
    const borderWidth = parseFloat(style.borderWidth) || (isGroup ? 1.5 : 1);
    const borderRadius = parseFloat(style.borderRadius) || (isGroup ? 8 : 6);

    const strokeDasharray = isGroup ? '6 3' : '';

    nodeRects.push(
      `<rect x="${pos.x}" y="${pos.y}" width="${size.width}" height="${size.height}" ` +
      `rx="${borderRadius}" ry="${borderRadius}" ` +
      `fill="${bgColor}" stroke="${borderColor}" stroke-width="${borderWidth}"` +
      (strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : '') +
      ` filter="url(#shadow)"/>`,
    );

    if (isGroup) {
      // Group header text
      const headerEl = domEl.querySelector('.graph-group-node-header') as HTMLElement | null;
      if (headerEl) {
        const headerStyle = getComputedStyle(headerEl);
        const fontSize = parseFloat(headerStyle.fontSize) || 12;
        const fontWeight = headerStyle.fontWeight || '600';
        const color = resolveColor(headerStyle.color, '#475569');
        const label = headerEl.textContent || '';
        nodeRects.push(
          `<text x="${pos.x + 10}" y="${pos.y + fontSize + 4}" ` +
          `font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" ` +
          `font-weight="${fontWeight}" fill="${color}">${escapeXml(label)}</text>`,
        );
      }
    } else {
      // Regular node label
      const fontSize = parseFloat(style.fontSize) || 14;
      const color = resolveColor(style.color, '#111827');
      const label = node.data.label ?? node.data.node.label;
      nodeRects.push(
        `<text x="${pos.x + size.width / 2}" y="${pos.y + size.height / 2}" ` +
        `text-anchor="middle" dominant-baseline="central" ` +
        `font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" ` +
        `fill="${color}">${escapeXml(label)}</text>`,
      );
    }
  }

  // Render edges — read paths and their markers from the live DOM
  const markerDefs = new Map<string, string>();
  const edgePathEls = Array.from(flowEl.querySelectorAll('.react-flow__edge-path'));
  for (const pathEl of edgePathEls) {
    const d = pathEl.getAttribute('d');
    if (!d) continue;
    const pathStyle = getComputedStyle(pathEl as Element);
    const stroke = resolveColor(pathStyle.stroke, '#9dbaea');
    const strokeWidth = parseFloat(pathStyle.strokeWidth) || 3;

    // Read the marker-end reference, find the DOM marker, and resolve its styling
    let markerRef = '';
    const markerEndAttr = pathEl.getAttribute('marker-end') || '';
    if (markerEndAttr && markerEndAttr !== 'none') {
      const markerEl = findMarkerEl(flowEl, markerEndAttr);
      const marker = markerEl ? cloneMarkerEl(markerEl, stroke) : fallbackMarker(stroke);

      // Convert to userSpaceOnUse: if original uses strokeWidth units,
      // multiply dimensions by the edge's stroke-width to get flow units
      let mw = parseFloat(marker.markerWidth) || 10;
      let mh = parseFloat(marker.markerHeight) || 10;
      if (marker.markerUnits === 'strokeWidth') {
        mw *= strokeWidth;
        mh *= strokeWidth;
      }

      // Dedup key includes color, size, shape, and orient to avoid collapsing different marker types
      const shapeHash = marker.shapeSvg.length;
      const markerId = `export-arrow-${marker.color.replace(/[^a-zA-Z0-9]/g, '_')}-${mw.toFixed(1)}-${marker.orient}-${shapeHash}`;
      if (!markerDefs.has(markerId)) {
        markerDefs.set(markerId,
          `<marker id="${markerId}" viewBox="${escapeXml(marker.viewBox)}" refX="${escapeXml(marker.refX)}" refY="${escapeXml(marker.refY)}" ` +
          `markerWidth="${mw}" markerHeight="${mh}" ` +
          `markerUnits="userSpaceOnUse" orient="${escapeXml(marker.orient)}">` +
          `${marker.shapeSvg}</marker>`,
        );
      }
      markerRef = ` marker-end="url(#${markerId})"`;
    }

    edgePaths.push(
      `<path d="${escapeXml(d)}" fill="none" stroke="${stroke}" ` +
      `stroke-width="${strokeWidth}"${markerRef}/>`,
    );
  }

  const markers = Array.from(markerDefs.values());

  const defs =
    `<defs>` +
    markers.join('') +
    `<filter id="shadow"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.05"/></filter>` +
    `</defs>`;

  // Set SVG width/height to the scaled pixel dimensions so the browser
  // rasterizes at full target resolution (not 1x then bitmap-upscaled).
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" ` +
    `width="${viewBox.width * scale}" height="${viewBox.height * scale}">` +
    defs +
    // Edges behind nodes
    edgePaths.join('') +
    nodeRects.join('') +
    `</svg>`
  );
}

function svgToPng(svg: string, pixelWidth: number, pixelHeight: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);
      canvas.toBlob(
        (b) => {
          URL.revokeObjectURL(url);
          b ? resolve(b) : reject(new Error('canvas.toBlob returned null'));
        },
        'image/png',
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG image'));
    };
    img.src = url;
  });
}

function downloadBlob(blob: Blob) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `graph-${timestamp}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface UseScreenshotOptions {
  nodesRef: MutableRefObject<FlowNode<GraphNodeData>[]>;
  renderAllForCapture: boolean;
  setRenderAll: (value: boolean) => void;
  reactFlowInstanceRef: MutableRefObject<ReactFlowInstance | null>;
}

export function useScreenshot({ nodesRef, renderAllForCapture, setRenderAll, reactFlowInstanceRef }: UseScreenshotOptions) {
  const resolveRenderRef = useRef<(() => void) | null>(null);
  const inProgressRef = useRef(false);

  useEffect(() => {
    if (renderAllForCapture && resolveRenderRef.current) {
      resolveRenderRef.current();
      resolveRenderRef.current = null;
    }
  }, [renderAllForCapture]);

  return useCallback(async (mode: ScreenshotMode) => {
    if (inProgressRef.current) return;
    inProgressRef.current = true;
    try {
      const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
      if (!flowEl) return;

      const padding = 50;

      if (mode === 'visible-area') {
        const instance = reactFlowInstanceRef.current;
        if (!instance) return;

        const viewport = instance.getViewport();
        const flowRect = flowEl.getBoundingClientRect();

        // Convert visible screen area to flow coordinates
        const visibleX = -viewport.x / viewport.zoom;
        const visibleY = -viewport.y / viewport.zoom;
        const visibleWidth = flowRect.width / viewport.zoom;
        const visibleHeight = flowRect.height / viewport.zoom;

        const viewBox = {
          x: visibleX,
          y: visibleY,
          width: visibleWidth,
          height: visibleHeight,
        };

        const nodes = nodesRef.current;

        const scale = Math.min(
          MAX_IMAGE_SIZE / visibleWidth,
          MAX_IMAGE_SIZE / visibleHeight,
          4,
        );

        const svgString = buildGraphSvg(flowEl, nodes, viewBox, scale);
        const blob = await svgToPng(svgString, Math.round(visibleWidth * scale), Math.round(visibleHeight * scale));
        downloadBlob(blob);
        return;
      }

      // all-nodes mode — ensure a false→true transition so the useEffect always fires
      if (renderAllForCapture) {
        setRenderAll(false);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>((resolve) => {
        resolveRenderRef.current = resolve;
        setRenderAll(true);
      });
      // Wait two frames: one for React commit, one for ReactFlow to compute positionAbsolute
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

      try {
        const nodes = nodesRef.current;
        if (nodes.length === 0) return;

        // Compute bounds using getNodeSize (handles undefined width/height on group nodes)
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
          const p = getNodeAbsolutePosition(n);
          const s = getNodeSize(n);
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x + s.width);
          maxY = Math.max(maxY, p.y + s.height);
        }
        const contentWidth = (maxX - minX) + padding * 2;
        const contentHeight = (maxY - minY) + padding * 2;

        const viewBox = {
          x: minX - padding,
          y: minY - padding,
          width: contentWidth,
          height: contentHeight,
        };

        const scale = Math.min(
          MAX_IMAGE_SIZE / contentWidth,
          MAX_IMAGE_SIZE / contentHeight,
          4,
        );

        const svgString = buildGraphSvg(flowEl, nodes, viewBox, scale);
        const blob = await svgToPng(svgString, Math.round(contentWidth * scale), Math.round(contentHeight * scale));
        downloadBlob(blob);
      } finally {
        setRenderAll(false);
      }
    } catch (err) {
      setRenderAll(false);
      console.error('Screenshot capture failed:', err);
    } finally {
      inProgressRef.current = false;
    }
  }, [nodesRef, renderAllForCapture, setRenderAll, reactFlowInstanceRef]);
}
