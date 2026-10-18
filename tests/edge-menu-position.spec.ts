import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
  waitForLayoutGen,
  skeletonFromFixture,
} from './test-utils';

// One edge with TWO call sites, so a click opens the menu instead of jumping
// to the single site. The call sites live in two files nothing has loaded
// yet: the menu's own rows request them, and their arrival is the first
// change to `fileContents` after the menu opened. That change rebuilds the
// flow nodes; a rebuild that forgets the measured sizes makes React Flow
// drop every edge for a frame, and the remounted edge's (controlled) menu
// comes back anchored at the viewport's top-left corner.
const graphResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_B', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'A-B', from: 'A', to: 'B', occurrence_count: 2 },
  ],
  has_edges: [],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_B', path: 'mock/b.go' },
  ],
  warnings: [],
};

const occurrences = {
  rows: [
    { ref_id: 'r1', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 2, end_offset: 4 },
    { ref_id: 'r2', object_id: 'obj_B', path: 'mock/b.go', project_id: null, start_offset: 6, end_offset: 8 },
  ],
  next: null,
};

async function intercept(page: Page) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(skeletonFromFixture(graphResponse as any)),
    });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], next: null, total: 0 }),
    });
  });
  await page.route('**/v1/edge/**/occurrences**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(occurrences) });
  });
  await page.route('**/source/**', async (route) => {
    // Arrive after the menu has been positioned, as a real server's would.
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'package main\n\nfunc f() {}\n' });
  });
}

async function menuRect(page: Page) {
  return page.locator('[data-testid="context-menu-edge-A-B"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
}

test('edge menu stays where it opened while its call sites load their files', async ({ page }) => {
  await intercept(page);
  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, '"a" {};');
  await submitQuery(page);
  await waitForGraphNodeCount(page, 2);
  await ensureGraphApis(page);
  await waitForLayoutGen(page, 1);
  await page.waitForTimeout(300);

  const hit = page.locator('[data-testid="graph-edge-A-B"] .graph-edge-hit');
  const box = await hit.boundingBox();
  expect(box).not.toBeNull();
  // The curve passes near the middle of its bounding box.
  const sources = page.waitForResponse((r) => r.url().includes('/source/'));
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const menu = page.locator('[data-testid="context-menu-edge-A-B"]');
  await expect(menu).toBeVisible();
  const opened = await menuRect(page);
  // Sanity: the menu opened at the click, not already in the corner.
  expect(opened.x).toBeGreaterThan(100);
  expect(opened.y).toBeGreaterThan(100);

  // Both call sites render, their files arrive, fileContents changes.
  await expect(page.locator('[data-testid="edge-occurrence-r1"]')).toBeVisible();
  await expect(page.locator('[data-testid="edge-occurrence-r2"]')).toBeVisible();
  await sources;
  await page.waitForTimeout(600);

  await expect(menu).toBeVisible();
  const settled = await menuRect(page);
  expect(Math.abs(settled.x - opened.x)).toBeLessThan(4);
  expect(Math.abs(settled.y - opened.y)).toBeLessThan(4);
});
