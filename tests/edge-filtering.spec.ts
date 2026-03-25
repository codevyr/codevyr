import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// Graph with containment hierarchy A→B→C and a target node D.
// Edges: A→D, B→D, C→D (all ref edges to D).
// Expected: only C→D is displayed; A→D and B→D are redundant (implied by containment).
const graphResponse = {
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
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'File', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', start_offset: 0, end_offset: 20 },
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
    { id: 'A-D', from: 'A', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B' },
    { id: 'has-B-C', parent: 'B', child: 'C' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// Graph with two branches: A contains B1 and B2; B1 contains C1, B2 contains C2.
// Both C1→D and C2→D exist, plus B1→D, B2→D, A→D.
// Expected: C1→D and C2→D are kept; A→D, B1→D, B2→D are removed.
// Also: B2→E exists with no descendant edge to E → B2→E is kept.
const multiBranchResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'B1',
      label: 'B1',
      symbol_instances: [
        { id: 'si_B1', symbol: 'B1', object_id: 'obj_A', symbol_type: 'File', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'B2',
      label: 'B2',
      symbol_instances: [
        { id: 'si_B2', symbol: 'B2', object_id: 'obj_A', symbol_type: 'File', start_offset: 50, end_offset: 100 },
      ],
    },
    {
      id: 'C1',
      label: 'C1',
      symbol_instances: [
        { id: 'si_C1', symbol: 'C1', object_id: 'obj_A', symbol_type: 'Function', start_offset: 0, end_offset: 20 },
      ],
    },
    {
      id: 'C2',
      label: 'C2',
      symbol_instances: [
        { id: 'si_C2', symbol: 'C2', object_id: 'obj_A', symbol_type: 'Function', start_offset: 50, end_offset: 70 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_D', symbol_type: 'Function', start_offset: 10, end_offset: 20 },
      ],
    },
  ],
  edges: [
    { id: 'A-D', from: 'A', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'B1-D', from: 'B1', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'B2-D', from: 'B2', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
    { id: 'C1-D', from: 'C1', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C2-D', from: 'C2', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
    { id: 'B2-E', from: 'B2', to: 'E', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
  ],
  has_edges: [
    { id: 'has-A-B1', parent: 'A', child: 'B1' },
    { id: 'has-A-B2', parent: 'A', child: 'B2' },
    { id: 'has-B1-C1', parent: 'B1', child: 'C1' },
    { id: 'has-B2-C2', parent: 'B2', child: 'C2' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

async function interceptWithGraph(page: Page, response: object) {
  await page.route('**/query**', async (route) => {
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
}

test.describe('redundant containment edge filtering', () => {
  test('filters redundant ancestor edges when descendant has same target', async ({ page }) => {
    await interceptWithGraph(page, graphResponse);
    await loadApp(page);
    await ensureEditorApis(page);
    await page.locator('.monaco-editor').click();
    await setEditorQuery(page, '"test" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);

    // Only C→D should be rendered; A→D and B→D should be filtered out
    await expect(page.locator('[data-testid="graph-edge-C-D"]')).toBeAttached();
    await expect(page.locator('[data-testid="graph-edge-A-D"]')).not.toBeAttached();
    await expect(page.locator('[data-testid="graph-edge-B-D"]')).not.toBeAttached();
  });

  test('keeps edges from multiple branches and leaf-only edges', async ({ page }) => {
    await interceptWithGraph(page, multiBranchResponse);
    await loadApp(page);
    await ensureEditorApis(page);
    await page.locator('.monaco-editor').click();
    await setEditorQuery(page, '"multi" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 7);
    await ensureGraphApis(page);

    // C1→D and C2→D should be kept (deepest edges to D)
    await expect(page.locator('[data-testid="graph-edge-C1-D"]')).toBeAttached();
    await expect(page.locator('[data-testid="graph-edge-C2-D"]')).toBeAttached();

    // B2→E should be kept (no descendant of B2 has an edge to E)
    await expect(page.locator('[data-testid="graph-edge-B2-E"]')).toBeAttached();

    // A→D, B1→D, B2→D should be filtered out (descendants have edges to D)
    await expect(page.locator('[data-testid="graph-edge-A-D"]')).not.toBeAttached();
    await expect(page.locator('[data-testid="graph-edge-B1-D"]')).not.toBeAttached();
    await expect(page.locator('[data-testid="graph-edge-B2-D"]')).not.toBeAttached();
  });
});
