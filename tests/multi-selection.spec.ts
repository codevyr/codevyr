import { test, expect, Page } from '@playwright/test';
import {
  setupGraph,
  toolbarButton,
} from './test-utils';

async function isNodeSelected(page: Page, nodeId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const wrapper = document.querySelector(`[data-testid="graph-node-${id}"]`)?.closest('.react-flow__node');
    return wrapper?.classList.contains('selected') ?? false;
  }, nodeId);
}

/** Click on the ReactFlow node wrapper (not the inner div) so ReactFlow registers selection. */
function nodeWrapper(page: Page, nodeId: string) {
  return page.locator(`[data-testid="graph-node-${nodeId}"]`).locator('..');
}

test.describe('interaction mode toolbar', () => {
  test('Hand is active by default', async ({ page }) => {
    await setupGraph(page);
    await expect(toolbarButton(page, 'Hand')).toHaveClass(/toolbar-btn-active/);
    await expect(toolbarButton(page, 'Select')).not.toHaveClass(/toolbar-btn-active/);
  });

  test('clicking Select/Hand toggles active state', async ({ page }) => {
    await setupGraph(page);
    const hand = toolbarButton(page, 'Hand');
    const sel = toolbarButton(page, 'Select');

    await sel.click();
    await expect(sel).toHaveClass(/toolbar-btn-active/);
    await expect(hand).not.toHaveClass(/toolbar-btn-active/);

    await hand.click();
    await expect(hand).toHaveClass(/toolbar-btn-active/);
    await expect(sel).not.toHaveClass(/toolbar-btn-active/);
  });

  test('H and V keyboard shortcuts switch mode', async ({ page }) => {
    await setupGraph(page);
    // Focus the graph area (not an input)
    await page.locator('.react-flow__pane').click();

    await page.keyboard.press('v');
    await expect(toolbarButton(page, 'Select')).toHaveClass(/toolbar-btn-active/);

    await page.keyboard.press('h');
    await expect(toolbarButton(page, 'Hand')).toHaveClass(/toolbar-btn-active/);
  });

  test('select mode applies crosshair cursor class', async ({ page }) => {
    await setupGraph(page);
    const rf = page.locator('.react-flow');
    await expect(rf).not.toHaveClass(/graph-select-mode/);

    await toolbarButton(page, 'Select').click();
    await expect(rf).toHaveClass(/graph-select-mode/);

    await toolbarButton(page, 'Hand').click();
    await expect(rf).not.toHaveClass(/graph-select-mode/);
  });
});

test.describe('node selection', () => {
  test('clicking a node selects it', async ({ page }) => {
    await setupGraph(page);
    await nodeWrapper(page, '4').click();

    await expect.poll(() => isNodeSelected(page, '4')).toBe(true);
  });

  test('Shift+click adds to selection', async ({ page }) => {
    await setupGraph(page);
    await nodeWrapper(page, '4').click();
    await expect.poll(() => isNodeSelected(page, '4')).toBe(true);

    await nodeWrapper(page, '22').click({ modifiers: ['Shift'] });
    await expect.poll(() => isNodeSelected(page, '4')).toBe(true);
    await expect.poll(() => isNodeSelected(page, '22')).toBe(true);
  });

  test('clicking pane deselects all', async ({ page }) => {
    await setupGraph(page);
    await nodeWrapper(page, '4').click();
    await expect.poll(() => isNodeSelected(page, '4')).toBe(true);

    // After viewport centering, the pane center may coincide with a node.
    // Click an empty spot by finding the pane's top-left in absolute coords.
    const rf = page.locator('.react-flow');
    const rfBox = await rf.boundingBox();
    await page.mouse.click(rfBox!.x + 2, rfBox!.y + 2);
    await expect.poll(() => isNodeSelected(page, '4')).toBe(false);
  });

  test('Shift+click skips file navigation', async ({ page }) => {
    await setupGraph(page);
    // Shift+click should NOT trigger a source fetch
    let sourceFetched = false;
    await page.route('**/source/**', async (route) => {
      sourceFetched = true;
      await route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    });

    await nodeWrapper(page, '4').click({ modifiers: ['Shift'] });
    await page.waitForTimeout(500);
    expect(sourceFetched).toBe(false);
  });
});
