import { test, expect } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// A node with two instances so a click opens the context menu.
const graphResponse = {
  nodes: [
    {
      id: 'N',
      label: 'N',
      symbol_instances: [
        { id: 'i1', symbol: 'N', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
        { id: 'i2', symbol: 'N', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'declaration', start_offset: 20, end_offset: 30 },
      ],
    },
  ],
  edges: [],
  has_edges: [],
  objects: [{ object_id: 'obj_A', path: 'mock/a.go' }],
  warnings: [],
};

test.describe('context menu persistence', () => {
  test('survives a window switch; Escape and outside clicks still close it', async ({ page }) => {
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
    await loadApp(page);
    await ensureEditorApis(page);
    await page.locator('.monaco-editor').click();
    await setEditorQuery(page, '"n" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 1);
    await ensureGraphApis(page);

    await page.locator('[data-testid="graph-node-N"]').click();
    const menu = page.locator('[data-testid="context-menu-node-N"]');
    await expect(menu).toBeVisible();

    // Window switch: the browser fires `blur` on window — the exact event
    // Radix's menu closes on. (Headless tab switching does not fire it, so
    // dispatch it directly; it carries no detail Radix inspects.) The menu
    // must NOT close — the user was mid-inspection.
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForTimeout(200);
    await expect(menu).toBeVisible();

    // Legit closes still work: Escape…
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    // …and a pointer-down outside.
    await page.locator('[data-testid="graph-node-N"]').click();
    await expect(menu).toBeVisible();
    await page.mouse.click(40, 400);
    await expect(menu).not.toBeVisible();
  });
});
