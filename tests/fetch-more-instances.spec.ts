import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// The skeleton carries no instances: every node loads its own when opened.
// BIG is a module (a container), the exact shape whose instances used to
// vanish — they were all `containment`, and the hover filtered those out.
const skeleton = {
  nodes: [
    {
      id: 'BIG',
      symbol_ids: ['BIG'],
      label: 'BIG',
      symbol_type: 'Module',
      is_directory: true,
      instance_count: 3,
      parent_symbol: null,
      query_statements: [],
    },
    {
      id: 'SIB',
      symbol_ids: ['SIB'],
      label: 'SIB',
      symbol_type: 'Function',
      is_directory: false,
      instance_count: 2,
      parent_symbol: null,
      query_statements: [],
    },
  ],
  edges: [],
  has_edges: [],
  warnings: [],
  truncated: false,
  total_symbols: 2,
  edges_truncated: [],
};

const page1 = {
  rows: [
    { id: 'i1', instance_type: 'containment', object_id: 'obj_A', path: 'mock/a.go', project_id: '1', start_offset: 0, end_offset: 10 },
    { id: 'i2', instance_type: 'containment', object_id: 'obj_A', path: 'mock/a.go', project_id: '1', start_offset: 20, end_offset: 30 },
  ],
  next: 'obj_A:20:i2',
  total: 3,
};

const page2 = {
  rows: [
    { id: 'i3', instance_type: 'definition', object_id: 'obj_A', path: 'mock/a.go', project_id: '1', start_offset: 40, end_offset: 50 },
  ],
  next: null,
  total: 3,
};

async function intercept(page: Page, requests: string[], fail = false) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(skeleton),
    });
  });
  await page.route('**/source/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'package main\n' });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    if (fail) {
      await route.fulfill({ status: 500, body: 'boom' });
      return;
    }
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(url.searchParams.get('after') ? page2 : page1),
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

test.describe('node instances load on demand', () => {
  test('a container node renders its instances — the case that used to come up empty', async ({ page }) => {
    const requests: string[] = [];
    await intercept(page, requests);
    await openGraph(page);

    // A container node's left click reveals it in the tree; the hover (what
    // this test is about) opens with a right click.
    await page.locator('[data-testid="graph-node-BIG"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="context-menu-node-BIG"]')).toBeVisible();

    // Directory instances must RENDER; the old hover filtered them away.
    await expect(page.locator('[data-testid="instance-row-i1"]')).toBeVisible();
    await expect(page.locator('[data-testid="instance-row-i2"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-node-BIG"]')).toContainText('Containment');
    // The total is the endpoint's exact count, not a result-derived guess.
    await expect(page.locator('[data-testid="load-instances-row"]')).toContainText('2 of 3 shown');
    expect(requests[0]).toContain('/v1/symbol/BIG/instances');
    expect(requests[0]).not.toContain('after=');
  });

  test('load more pages with the display cursor and appends', async ({ page }) => {
    const requests: string[] = [];
    await intercept(page, requests);
    await openGraph(page);

    await page.locator('[data-testid="graph-node-BIG"]').click({ button: 'right' });
    await page.locator('[data-testid="instance-row-i1"]').waitFor();
    await page.locator('[data-testid="load-instances-more"]').click();

    await expect(page.locator('[data-testid="instance-row-i3"]')).toBeVisible();
    await expect(page.locator('[data-testid="instance-row-i1"]')).toBeVisible();
    expect(requests[1]).toContain('after=obj_A%3A20%3Ai2');
    // Listing exhausted.
    await expect(page.locator('[data-testid="load-instances-more"]')).not.toBeAttached();
  });

  test('a failed instances request shows an error and keeps the hover usable', async ({ page }) => {
    await intercept(page, [], true);
    await openGraph(page);

    await page.locator('[data-testid="graph-node-BIG"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="instances-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="context-menu-node-BIG"]')).toBeVisible();
  });
});
