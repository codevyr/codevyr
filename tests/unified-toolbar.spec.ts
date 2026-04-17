import { test, expect } from '@playwright/test';
import {
  interceptGraphEndpoints,
  loadApp,
  setEditorQuery,
  setupGraph,
  toolbarButton,
  waitForGraphNodeCount,
} from './test-utils';
import { SUBMIT_QUERY } from './mock-responses';

test.describe('unified toolbar', () => {
  test('toolbar renders above layout', async ({ page }) => {
    await interceptGraphEndpoints(page);
    await loadApp(page);

    const toolbar = page.locator('.toolbar-container');
    const layout = page.locator('.flexlayout__layout');

    await expect(toolbar).toBeVisible();
    await expect(layout).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();
    const layoutBox = await layout.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(layoutBox).not.toBeNull();
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(layoutBox!.y + 1);
  });

  test('Run button executes query', async ({ page }) => {
    await interceptGraphEndpoints(page);
    await loadApp(page);
    await page.locator('.monaco-editor').click();
    await setEditorQuery(page, SUBMIT_QUERY);

    const queryResponse = page.waitForResponse(/\/query/);
    await toolbarButton(page, 'Run').click();
    await queryResponse;
    await waitForGraphNodeCount(page, 3);
  });

  test('Query dropdown shows Save, Open, Share', async ({ page }) => {
    await interceptGraphEndpoints(page);
    await loadApp(page);

    await toolbarButton(page, 'Query').click();

    const menu = page.locator('.context-menu-content');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.dropdown-menu-item', { hasText: 'Save to File...' })).toBeVisible();
    await expect(menu.locator('.dropdown-menu-item', { hasText: 'Open from File...' })).toBeVisible();
    await expect(menu.locator('.dropdown-menu-item', { hasText: 'Share Link' })).toBeVisible();
  });

  test('Share Link copies URL and shows feedback', async ({ page }) => {
    // Grant clipboard permissions before page load
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await interceptGraphEndpoints(page);
    await loadApp(page);
    await page.locator('.monaco-editor').click();
    await setEditorQuery(page, SUBMIT_QUERY);

    await toolbarButton(page, 'Query').click();
    await page.locator('.dropdown-menu-item', { hasText: 'Share Link' }).click();

    // Feedback text should appear near the toolbar
    await expect(page.locator('.toolbar-container', { hasText: 'Copied' })).toBeVisible();

    // Verify clipboard actually contains a URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toMatch(/^https?:\/\//);
  });

  test('graph buttons are disabled before first query', async ({ page }) => {
    await interceptGraphEndpoints(page);
    await loadApp(page);

    const graphButtons = ['Hand', 'Select', 'Merge', 'Redraw', 'Center', 'Fit View', 'Reset Zoom', 'Search', 'Screenshot'];
    for (const label of graphButtons) {
      await expect(toolbarButton(page, label)).toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('graph buttons become enabled after query', async ({ page }) => {
    await setupGraph(page);

    const graphButtons = ['Hand', 'Select', 'Merge', 'Redraw', 'Center', 'Fit View', 'Reset Zoom', 'Search', 'Screenshot'];
    for (const label of graphButtons) {
      await expect(toolbarButton(page, label)).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  test('Merge button toggles active state', async ({ page }) => {
    await setupGraph(page);

    const merge = toolbarButton(page, 'Merge');
    // Merge is active by default
    await expect(merge).toHaveClass(/toolbar-btn-active/);

    await merge.click();
    await expect(merge).not.toHaveClass(/toolbar-btn-active/);

    await merge.click();
    await expect(merge).toHaveClass(/toolbar-btn-active/);
  });
});
