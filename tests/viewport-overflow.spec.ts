import { test, expect } from '@playwright/test';
import { interceptGraphEndpoints, loadApp, setupGraph } from './test-utils';

/**
 * Verify that the page content fits within the viewport.
 * This catches regressions where hidden measurement elements or layout
 * overflow cause the body to extend beyond the visible area, letting
 * the toolbar scroll out of view.
 */
async function expectNoViewportOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => ({
    bodyScrollH: document.body.scrollHeight,
    viewportH: window.innerHeight,
  }));
  expect(overflow.bodyScrollH, 'body should not overflow viewport').toBeLessThanOrEqual(overflow.viewportH);
}

test.describe('viewport overflow', () => {
  test('page is not scrollable on initial load', async ({ page }) => {
    await interceptGraphEndpoints(page);
    await loadApp(page);
    await expectNoViewportOverflow(page);
  });

  test('page is not scrollable after running a query', async ({ page }) => {
    await setupGraph(page);
    await expectNoViewportOverflow(page);
  });

  test('toolbar remains in viewport after running a query', async ({ page }) => {
    await setupGraph(page);

    const toolbar = page.locator('.toolbar-container');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toBeInViewport();
  });
});
