import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
  skeletonFromFixture,
} from './test-utils';

// HUB's out-edges were capped by the server: one edge (HUB→T1) shipped, the
// rest are behind the references endpoint. SIB is an untruncated sibling with
// two instances (so clicking it opens a menu too, for the no-section check).
const graphResponse = {
  nodes: [
    {
      id: 'HUB',
      label: 'HUB',
      symbol_instances: [
        { id: 'si_HUB', symbol: 'HUB', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'SIB',
      label: 'SIB',
      symbol_instances: [
        { id: 'si_SIB1', symbol: 'SIB', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 20, end_offset: 30 },
        { id: 'si_SIB2', symbol: 'SIB', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'declaration', start_offset: 40, end_offset: 50 },
      ],
    },
    {
      id: 'T1',
      label: 'T1',
      symbol_instances: [
        { id: 'si_T1', symbol: 'T1', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 60, end_offset: 70 },
      ],
    },
  ],
  edges: [
    { id: 'HUB-T1', from: 'HUB', to: 'T1', from_object: 'obj_A', from_offset_start: 2, from_offset_end: 4 },
    { id: 'SIB-T1', from: 'SIB', to: 'T1', from_object: 'obj_A', from_offset_start: 22, from_offset_end: 24 },
  ],
  has_edges: [],
  objects: [{ object_id: 'obj_A', path: 'mock/a.go' }],
  warnings: [],
  edges_truncated: ['HUB'],
};

const page1 = {
  kind: 'refs',
  rows: [
    { to_symbol: 'T2', to_symbol_name: 'T2', to_instance_id: 'si_T2', from_instance_id: 'si_HUB', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 3, end_offset: 5 },
    { to_symbol: 'T3', to_symbol_name: 'T3', to_instance_id: 'si_T3', from_instance_id: 'si_HUB', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 6, end_offset: 8 },
  ],
  next: 'si_HUB:2',
  count: 4,
  count_capped: false,
};

const page2 = {
  kind: 'refs',
  rows: [
    { to_symbol: 'T4', to_symbol_name: 'T4', to_instance_id: 'si_T4', from_instance_id: 'si_HUB', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 9, end_offset: 11 },
    { to_symbol: 'T5', to_symbol_name: 'T5', to_instance_id: 'si_T5', from_instance_id: 'si_HUB', object_id: 'obj_A', path: 'mock/a.go', project_id: null, start_offset: 12, end_offset: 14 },
  ],
  next: null,
  count: 4,
  count_capped: false,
};

async function interceptGraph(page: Page) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(skeletonFromFixture(graphResponse as any)),
    });
  });
  await page.route('**/source/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'package main\n' });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/\/v1\/symbol\/([^/]+)\/instances/);
    const node = (graphResponse as any).nodes.find((n: any) => n.id === m?.[1]);
    const rows = (node?.symbol_instances ?? []).map((i: any) => ({
      id: i.id,
      instance_type: i.instance_type,
      object_id: i.object_id,
      path: 'mock/a.go',
      project_id: i.project_id ?? '1',
      start_offset: i.start_offset,
      end_offset: i.end_offset,
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows, next: null, total: rows.length }),
    });
  });
}

/** Record every references request; serve page1/page2 keyed on `after`. */
async function interceptReferences(page: Page, requests: string[]) {
  await page.route('**/v1/symbol/**/references**', async (route) => {
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
  await setEditorQuery(page, '"hub" {};');
  await submitQuery(page);
  await waitForGraphNodeCount(page, 3);
  await ensureGraphApis(page);
}

test.describe('fetch-more references (edges_truncated)', () => {
  test('a truncated node opens the menu on click and shows the section; an untruncated one shows none', async ({ page }) => {
    await interceptGraph(page);
    await interceptReferences(page, []);
    await openGraph(page);

    // HUB has ONE instance — without the truncation marker this click would
    // jump straight to source; the marker must force the menu open instead.
    await page.locator('[data-testid="graph-node-HUB"]').click();
    await expect(page.locator('[data-testid="context-menu-node-HUB"]')).toBeVisible();
    await expect(page.locator('[data-testid="more-references-HUB"]')).toBeVisible();
    const loadBtn = page.locator('[data-testid="load-references-HUB"]');
    await expect(loadBtn).toBeVisible();
    // A labeled button, not a 24x24 icon square: text-button class and a
    // bounding box wider than tall.
    await expect(loadBtn).toHaveClass(/node-hover-text-btn/);
    await expect(loadBtn).not.toHaveClass(/node-hover-icon/);
    const box = await loadBtn.boundingBox();
    expect(box && box.width > box.height).toBe(true);
    await page.keyboard.press('Escape');

    // SIB opens a menu too (two instances) but has no fetch-more section.
    await page.locator('[data-testid="graph-node-SIB"]').click();
    await expect(page.locator('[data-testid="context-menu-node-SIB"]')).toBeVisible();
    await expect(page.locator('[data-testid="more-references-SIB"]')).not.toBeAttached();
  });

  test('loading renders rows without touching the graph; a second load pages with the cursor', async ({ page }) => {
    const requests: string[] = [];
    await interceptGraph(page);
    await interceptReferences(page, requests);
    await openGraph(page);

    await page.locator('[data-testid="graph-node-HUB"]').click();
    await page.locator('[data-testid="load-references-HUB"]').click();

    // Page 1 rows render inside the hover, count label updates, graph untouched.
    await expect(page.locator('[data-testid="reference-row-T2-3"]')).toBeVisible();
    await expect(page.locator('[data-testid="reference-row-T3-6"]')).toBeVisible();
    await expect(page.locator('[data-testid="more-references-HUB"]')).toContainText('More references (4)');
    await waitForGraphNodeCount(page, 3);
    expect(requests[0]).toContain('/v1/symbol/HUB/references');
    expect(requests[0]).not.toContain('after=');

    // Second click pages: the request carries the cursor verbatim and the
    // new rows APPEND (all four visible, none duplicated).
    await page.locator('[data-testid="load-references-HUB"]').click();
    await expect(page.locator('[data-testid="reference-row-T4-9"]')).toBeVisible();
    await expect(page.locator('[data-testid="reference-row-T5-12"]')).toBeVisible();
    await expect(page.locator('[data-testid="reference-row-T2-3"]')).toBeVisible();
    expect(requests[1]).toContain('after=si_HUB%3A2');

    // next == null: the load button is gone.
    await expect(page.locator('[data-testid="load-references-HUB"]')).not.toBeAttached();
  });

  test('a failed references request shows an error row and leaves the hover usable', async ({ page }) => {
    await interceptGraph(page);
    await page.route('**/v1/symbol/**/references**', async (route) => {
      await route.fulfill({ status: 500, body: 'boom' });
    });
    await openGraph(page);

    await page.locator('[data-testid="graph-node-HUB"]').click();
    await page.locator('[data-testid="load-references-HUB"]').click();
    await expect(page.locator('[data-testid="references-error-HUB"]')).toBeVisible();
    // The rest of the hover still works: the load button is still offered.
    await expect(page.locator('[data-testid="load-references-HUB"]')).toBeVisible();
  });

  test('a fetch-more in flight does not cancel a newly submitted main query', async ({ page }) => {
    await interceptGraph(page);
    await page.route('**/v1/symbol/**/references**', async (route) => {
      // Slow references response: still in flight while the query re-runs.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });
    await openGraph(page);

    await page.locator('[data-testid="graph-node-HUB"]').click();
    await page.locator('[data-testid="load-references-HUB"]').click();
    await page.keyboard.press('Escape');

    // Re-submit the main query while the references request sleeps: the
    // graph must render normally (a shared abort controller would kill it).
    // The submit shortcut needs editor focus, which the Escape dropped.
    await page.locator('.monaco-editor').click();
    await submitQuery(page);
    await waitForGraphNodeCount(page, 3);
  });
});
