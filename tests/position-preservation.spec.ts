import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// First query: hierarchy A contains B and C, plus standalone D.
// Edges: B→D, C→D.
const firstResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', start_offset: 50, end_offset: 80 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B' },
    { id: 'has-A-C', parent: 'A', child: 'C' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// Second query: same hierarchy (A contains B, C) plus D and new node E.
// Same structure, just an extra node — B, C, D positions should be preserved.
const secondResponseSameHierarchy = {
  nodes: [
    ...firstResponse.nodes,
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_D', symbol_type: 'Function', start_offset: 10, end_offset: 20 },
      ],
    },
  ],
  edges: [
    ...firstResponse.edges,
    { id: 'D-E', from: 'D', to: 'E', from_object: 'obj_D', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: firstResponse.has_edges,
  objects: firstResponse.objects,
  warnings: [],
};

// Third response: hierarchy changes — C moves from child of A to child of D.
const thirdResponseChangedHierarchy = {
  nodes: firstResponse.nodes,
  edges: firstResponse.edges,
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B' },
    { id: 'has-D-C', parent: 'D', child: 'C' },
  ],
  objects: firstResponse.objects,
  warnings: [],
};

type NodePositions = Record<string, { x: number; y: number }>;

async function getNodePositions(page: Page, nodeIds: string[]): Promise<NodePositions> {
  return page.evaluate((ids) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="graph-node-${id}"]`);
      if (!el) continue;
      const wrapper = el.closest('.react-flow__node') as HTMLElement | null;
      if (!wrapper) continue;
      const transform = wrapper.style.transform;
      // Match both translate(x, y) and translate3d(x, y, z)
      const match = transform.match(/translate(?:3d)?\(([^,]+),\s*([^,)]+)/);
      if (match) {
        positions[id] = {
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
        };
      }
    }
    return positions;
  }, nodeIds);
}

async function waitForLayoutGen(page: Page, minGen: number) {
  await page.waitForFunction((gen) => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    const current = el?.getAttribute('data-layout-gen');
    return current !== null && Number(current) >= gen;
  }, minGen);
}

async function getLayoutGen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    return Number(el?.getAttribute('data-layout-gen') ?? '0');
  });
}

async function setupSequentialMocks(page: Page, responses: object[]) {
  let queryCount = 0;
  await page.route('**/query**', async (route) => {
    const response = responses[queryCount] ?? responses[responses.length - 1];
    queryCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
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

test.describe('node position preservation across re-execution', () => {
  test('preserves existing positions when new nodes are added with hierarchy', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, secondResponseSameHierarchy]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['A', 'B', 'C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(4);

    // Second query — same hierarchy, adds node E
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 5);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D', 'E']);

    // Preserved nodes should stay close to their original positions
    for (const id of ['B', 'C', 'D']) {
      expect(positionsAfter[id]?.x, `node ${id} x`).toBeCloseTo(positionsBefore[id]!.x, 0);
      expect(positionsAfter[id]?.y, `node ${id} y`).toBeCloseTo(positionsBefore[id]!.y, 0);
    }

    // New node E should exist
    expect(positionsAfter['E']).toBeDefined();
  });

  test('identical re-execution preserves all positions', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, firstResponse]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['A', 'B', 'C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(4);

    // Re-run identical query
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D']);

    // Every node should be pixel-identical
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(positionsAfter[id]?.x, `node ${id} x should be preserved`).toBeCloseTo(positionsBefore[id]!.x, 0);
      expect(positionsAfter[id]?.y, `node ${id} y should be preserved`).toBeCloseTo(positionsBefore[id]!.y, 0);
    }
  });

  test('does full relayout when hierarchy changes', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, thirdResponseChangedHierarchy]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    // Second query — C moves from child of A to child of D
    // Hierarchy changed, so full relayout occurs (no partial preservation)
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D']);

    // All nodes should have positions (layout completed successfully)
    expect(Object.keys(positionsAfter)).toHaveLength(4);

    // C is now child of D — verify C's position is below D (direction is DOWN)
    expect(positionsAfter['C']!.y, 'child C should be below parent D').toBeGreaterThan(positionsAfter['D']!.y);
  });
});
