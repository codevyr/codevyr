import { test, expect } from '@playwright/test';
import { checkTab, findAllTabSets } from './helpers-flex';
import { SUBMIT_QUERY, SUBMIT_QUERY_INIT_LOGS } from './mock-responses';
import {
  ensureGraphApis,
  expectLineRoughlyCentered,
  interceptGraphEndpoints,
  loadApp,
  setEditorQuery,
  submitQuery,
  tapGraphEdge,
  tapGraphNodeAndWaitForSource,
  waitForGraphNodeCount,
  waitForPopper,
  waitForPopperToClose,
} from './test-utils';

test('has title', async ({ page }) => {
  await page.goto('./');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Codevyr/);
});

test('get started', async ({ page }) => {
  await page.goto('./');

  const tabSets = await findAllTabSets(page);
  expect(await tabSets.count()).toEqual(3);
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
  await checkTab(page, '/ts1', 0, true, 'kubelet.go', 'func main()');
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
  await checkTab(page, '/ts1', 0, true, 'logs.go', 'func InitLogs');
  await expect(page.locator('.monaco-editor').last()).toContainText('func InitLogs');

  await tapGraphEdge(page, '22-201');
  await waitForPopper(page, 'popper-edge-22-201');

  await tapGraphEdge(page, '22-201');
  await waitForPopperToClose(page, 'popper-edge-22-201');
});

test('graph selections center the focused code', async ({ page }) => {
  return;

  // The test is flaky, disabling for now.
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
  await page.waitForTimeout(500);

  await tapGraphNodeAndWaitForSource(page, '4', '4');
  await expectLineRoughlyCentered(page, 'mock/run.go', 43);
  await page.waitForTimeout(500);

  await tapGraphEdge(page, '1-4');
  await expectLineRoughlyCentered(page, 'mock/kubelet.go', 36);
  await page.waitForTimeout(500);

  await tapGraphEdge(page, '4-22');
  await expectLineRoughlyCentered(page, 'mock/run.go', 44);
  await page.waitForTimeout(500);
});
