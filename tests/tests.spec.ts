import { test, expect } from '@playwright/test';
import { findAllTabSets } from './helpers-flex';
import { SUBMIT_QUERY, SUBMIT_QUERY_INIT_LOGS } from './mock-responses';
import {
  ensureEditorApis,
  ensureGraphApis,
  expectLineRoughlyCentered,
  interceptGraphEndpoints,
  loadApp,
  setEditorQuery,
  submitQuery,
  tapGraphEdge,
  tapGraphNodeAndWaitForSource,
  waitForGraphNodeCount,
  waitForContextMenu,
  waitForContextMenuToClose,
} from './test-utils';
import { encodeQuery } from '../src/app/lib/query_share';

test('has title', async ({ page }) => {
  await loadApp(page);

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Codevyr/);
});

test('get started', async ({ page }) => {
  await loadApp(page);

  const tabSets = findAllTabSets(page);
  await expect(tabSets).toHaveCount(4);
});

test('loads query from share link hash', async ({ page }) => {
  const sharedQuery = 'graph {\\n  foo -> bar\\n}';
  const encoded = encodeQuery(sharedQuery);
  // Mock projects endpoint to suppress "Failed to load projects" error
  await page.route('**/v1/index/projects**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.goto(`./#q=${encoded}`);
  await ensureEditorApis(page);

  await page.waitForFunction(expected => {
    const getQuery = (window as any).__asklGetQuery;
    return typeof getQuery === 'function' && getQuery() === expected;
  }, sharedQuery);
});

test('query editor submits and renders three graph nodes', async ({ page }) => {
  await interceptGraphEndpoints(page);
  await loadApp(page);

  const editor = page.locator('.monaco-editor');
  await editor.click();

  await setEditorQuery(page, SUBMIT_QUERY);
  await submitQuery(page);

  await waitForGraphNodeCount(page, 3);
  await ensureGraphApis(page);

  await tapGraphNodeAndWaitForSource(page, '1', '1');

  await expect(page.locator('[data-testid="graph-metadata"]')).toHaveAttribute('data-node-count', '3');
  await expect(page.locator('.monaco-editor').last()).toContainText('func main()');
});

test('query editor highlights InitLogs and opens logs.go', async ({ page }) => {
  await interceptGraphEndpoints(page);
  await loadApp(page);

  const editor = page.locator('.monaco-editor');
  await editor.click();

  await setEditorQuery(page, SUBMIT_QUERY_INIT_LOGS);
  await submitQuery(page);

  await waitForGraphNodeCount(page, 4);
  await ensureGraphApis(page);

  await tapGraphNodeAndWaitForSource(page, '201', '11');

  await expect(page.locator('[data-testid="graph-metadata"]')).toHaveAttribute('data-node-count', '4');
  await expect(page.locator('.monaco-editor').last()).toContainText('func InitLogs');

  await tapGraphEdge(page, '22-201');
  await waitForContextMenu(page, 'context-menu-edge-22-201');

  await tapGraphEdge(page, '22-201');
  await waitForContextMenuToClose(page, 'context-menu-edge-22-201');
});

test('graph selections center the focused code', async ({ page }) => {
  await interceptGraphEndpoints(page);
  await loadApp(page);

  const editor = page.locator('.monaco-editor').first();
  await editor.click();

  await setEditorQuery(page, SUBMIT_QUERY);
  await submitQuery(page);

  await waitForGraphNodeCount(page, 3);
  await ensureGraphApis(page);

  await tapGraphNodeAndWaitForSource(page, '1', '1');
  await expectLineRoughlyCentered(page, 'mock/kubelet.go', 34);

  await tapGraphNodeAndWaitForSource(page, '4', '4');
  await expectLineRoughlyCentered(page, 'mock/run.go', 43);

  await tapGraphEdge(page, '1-4');
  await expectLineRoughlyCentered(page, 'mock/kubelet.go', 36);

  await tapGraphEdge(page, '4-22');
  await expectLineRoughlyCentered(page, 'mock/run.go', 44);
});
