import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// BIG's instance list was capped by the server (2 of 931 shipped); SIB is
// complete.  BIG has a single shipped instance pair, so without the marker a
// click would jump straight to source.
const graphResponse = {
  nodes: [
    {
      id: 'BIG',
      label: 'BIG',
      symbol_instances: [
        { id: 'si_B1', symbol: 'BIG', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
        { id: 'si_B2', symbol: 'BIG', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'declaration', start_offset: 20, end_offset: 30 },
      ],
      instances_truncated: true,
      total_instances: 931,
    },
    {
      id: 'SIB',
      label: 'SIB',
      symbol_instances: [
        { id: 'si_S1', symbol: 'SIB', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 40, end_offset: 50 },
        { id: 'si_S2', symbol: 'SIB', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'declaration', start_offset: 60, end_offset: 70 },
      ],
    },
  ],
  edges: [
    { id: 'BIG-SIB', from: 'BIG', to: 'SIB', from_object: 'obj_A', from_offset_start: 2, from_offset_end: 4 },
  ],
  has_edges: [],
  objects: [{ object_id: 'obj_A', path: 'mock/a.go' }],
  warnings: [],
  edges_truncated: [],
};

const page1 = {
  rows: [
    // si_B1 duplicates a shipped instance — the client must dedupe it.
    { id: 'si_B1', instance_type: 'definition', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 0, end_offset: 10 },
    { id: 'si_B3', instance_type: 'containment', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 100, end_offset: 110 },
  ],
  next: 'si_B3',
  total: 931,
};

const page2 = {
  rows: [
    { id: 'si_B4', instance_type: 'containment', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 120, end_offset: 130 },
  ],
  next: null,
  total: 931,
};

async function interceptAll(page: Page, requests: string[]) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graphResponse),
    });
  });
  await page.route('**/source/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'package main\n' });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    const after = url.searchParams.get('after');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(after ? page2 : page1),
    });
  });
}

async function openGraph(page: Page) {
  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, '"big" {};');
  await submitQuery(page);
  await waitForGraphNodeCount(page, 2);
  await ensureGraphApis(page);
}

test.describe('fetch-more instances (instances_truncated)', () => {
  test('a truncated node shows one whole-hover load control with the exact total; a complete sibling shows none', async ({ page }) => {
    await interceptAll(page, []);
    await openGraph(page);

    await page.locator('[data-testid="graph-node-BIG"]').click();
    await expect(page.locator('[data-testid="context-menu-node-BIG"]')).toBeVisible();
    // ONE control for the whole hover (instances are grouped by type — a
    // per-type or per-symbol button makes no sense), showing shipped/total.
    const loadRow = page.locator('[data-testid="load-instances-row"]');
    await expect(loadRow).toBeVisible();
    await expect(loadRow).toContainText('More instances (2 of 931 shown)');
    await expect(page.locator('[data-testid="load-instances-more"]')).toBeVisible();
    // No separate fetched-rows table exists.
    await expect(page.locator('[data-testid^="more-instances-"]')).not.toBeAttached();
    await page.keyboard.press('Escape');

    await page.locator('[data-testid="graph-node-SIB"]').click();
    await expect(page.locator('[data-testid="context-menu-node-SIB"]')).toBeVisible();
    await expect(page.locator('[data-testid="load-instances-row"]')).not.toBeAttached();
  });

  test('fetched instances merge into the typed sections, deduped, paging with the id cursor', async ({ page }) => {
    const requests: string[] = [];
    await interceptAll(page, requests);
    await openGraph(page);

    await page.locator('[data-testid="graph-node-BIG"]').click();
    await page.locator('[data-testid="load-instances-more"]').click();

    // The fetched containment instance lands INSIDE the hover's typed
    // sections — a "Containment" section appears in the main table.
    await expect(page.locator('[data-testid="instance-row-si_B3"]')).toBeVisible();
    const menu = page.locator('[data-testid="context-menu-node-BIG"]');
    await expect(menu).toContainText('Containment');
    // si_B1 was already shipped: exactly one row, not two.
    await expect(page.locator('[data-testid="instance-row-si_B1"]')).toHaveCount(1);
    // The label counts the merged rows.
    await expect(page.locator('[data-testid="load-instances-row"]')).toContainText('More instances (3 of 931 shown)');
    await waitForGraphNodeCount(page, 2);
    expect(requests[0]).toContain('/v1/symbol/BIG/instances');
    expect(requests[0]).not.toContain('after=');

    await page.locator('[data-testid="load-instances-more"]').click();
    await expect(page.locator('[data-testid="instance-row-si_B4"]')).toBeVisible();
    expect(requests[1]).toContain('after=si_B3');
    // Listing exhausted: the button goes away.
    await expect(page.locator('[data-testid="load-instances-more"]')).not.toBeAttached();
  });

  test('a failed instances request shows an error row and keeps the hover usable', async ({ page }) => {
    await interceptAll(page, []);
    await page.unroute('**/v1/symbol/**/instances**');
    await page.route('**/v1/symbol/**/instances**', async (route) => {
      await route.fulfill({ status: 500, body: 'boom' });
    });
    await openGraph(page);

    await page.locator('[data-testid="graph-node-BIG"]').click();
    await page.locator('[data-testid="load-instances-more"]').click();
    await expect(page.locator('[data-testid="instances-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="load-instances-more"]')).toBeVisible();
  });
});
