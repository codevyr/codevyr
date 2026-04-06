import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// Parent has a long label; child has a short label.
// This ensures the parent label is wider than the children bounding box,
// testing that the parent width expands to fit its own header text.
const nestedResponse = {
  nodes: [
    {
      id: 'outer',
      label: 'very_long_outer_directory_container_name',
      symbol_instances: [
        { id: 'si_outer', symbol: 'outer', object_id: 'obj1', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'inner',
      label: 'init',
      symbol_instances: [
        { id: 'si_inner', symbol: 'inner', object_id: 'obj1', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
  ],
  edges: [],
  has_edges: [
    { id: 'has-outer-inner', parent: 'outer', child: 'inner' },
  ],
  objects: [
    { object_id: 'obj1', path: 'mock/test.go' },
  ],
  warnings: [],
};

type NodeRect = { x: number; y: number; width: number; height: number };

async function getNodeRect(page: Page, nodeId: string): Promise<NodeRect> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="graph-node-${id}"]`);
    if (!el) throw new Error(`node ${id} not found`);
    const wrapper = el.closest('.react-flow__node') as HTMLElement | null;
    if (!wrapper) throw new Error(`wrapper for ${id} not found`);
    const transform = wrapper.style.transform;
    const match = transform.match(/translate(?:3d)?\(([^,]+),\s*([^,)]+)/);
    const x = match ? parseFloat(match[1]) : 0;
    const y = match ? parseFloat(match[2]) : 0;
    return {
      x,
      y,
      width: wrapper.offsetWidth,
      height: wrapper.offsetHeight,
    };
  }, nodeId);
}

async function waitForLayoutGen(page: Page, minGen: number) {
  await page.waitForFunction((gen) => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    const current = el?.getAttribute('data-layout-gen');
    return current !== null && Number(current) >= gen;
  }, minGen);
}

async function setupMock(page: Page) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(nestedResponse),
    });
  });

  await page.route('**/source/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'package main\n',
    });
  });

  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
}

async function checkHeaderOverflow(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="graph-node-outer"] .graph-group-node-header') as HTMLElement;
    const parent = document.querySelector('[data-testid="graph-node-outer"]') as HTMLElement;
    if (!header || !parent) return { ok: false, reason: 'elements not found' } as const;
    // scrollWidth includes padding + full text width; clientWidth is the visible area.
    // If scrollWidth > clientWidth, the text overflows its container.
    const textOverflows = header.scrollWidth > header.clientWidth + 1;
    return {
      ok: !textOverflows,
      scrollWidth: header.scrollWidth,
      clientWidth: header.clientWidth,
      parentWidth: parent.getBoundingClientRect().width,
    };
  });
}

async function dragNode(page: Page, nodeId: string, dx: number, dy: number) {
  const el = page.locator(`[data-testid="graph-node-${nodeId}"]`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`node ${nodeId} not visible`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in small steps so React Flow registers the drag
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + (dx * i) / steps,
      startY + (dy * i) / steps,
    );
  }
  await page.mouse.up();
}

test.describe('parent resize consistency', () => {
  test('parent dimensions stay the same after dragging inner node', async ({ page }) => {
    await setupMock(page);

    await setEditorQuery(page, '"test" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 2);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    // Wait for React Flow to finish measuring
    await page.waitForTimeout(300);

    const outerBefore = await getNodeRect(page, 'outer');
    expect(outerBefore.width).toBeGreaterThan(0);
    expect(outerBefore.height).toBeGreaterThan(0);

    // Drag the inner node a small amount (20px right, 10px down)
    await dragNode(page, 'inner', 20, 10);

    // Wait for resize to settle
    await page.waitForTimeout(200);

    const outerAfter = await getNodeRect(page, 'outer');

    // Dimensions should remain the same (position may change)
    expect(outerAfter.width).toBeCloseTo(outerBefore.width, 0);
    expect(outerAfter.height).toBeCloseTo(outerBefore.height, 0);
  });

  test('parent label stays within parent boundaries after drag', async ({ page }) => {
    await setupMock(page);

    await setEditorQuery(page, '"test" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 2);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);
    await page.waitForTimeout(300);

    // Drag the inner node to a narrow position (left)
    await dragNode(page, 'inner', -30, 0);
    await page.waitForTimeout(200);

    // Check that the outer label (group header) text doesn't overflow.
    // scrollWidth > clientWidth means the text content extends beyond the visible area.
    const overflow = await checkHeaderOverflow(page);
    expect(overflow.ok, `header text overflows after drag: ${JSON.stringify(overflow)}`).toBe(true);
  });

  test('parent label stays within boundaries on initial render', async ({ page }) => {
    await setupMock(page);

    await setEditorQuery(page, '"test" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 2);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);
    await page.waitForTimeout(300);

    const overflow = await checkHeaderOverflow(page);
    expect(overflow.ok, `header text overflows on initial render: ${JSON.stringify(overflow)}`).toBe(true);
  });
});
