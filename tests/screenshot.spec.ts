import { test, expect, Page } from '@playwright/test';
import { statSync } from 'fs';
import { setupGraph } from './test-utils';

async function openScreenshotMenu(page: Page) {
  await page.getByRole('button', { name: 'Screenshot' }).click();
}

async function captureScreenshot(page: Page, mode: 'All Nodes' | 'Visible Area') {
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await openScreenshotMenu(page);
  await page.getByRole('menuitem', { name: mode }).click();
  return downloadPromise;
}

test('screenshot visible area triggers a PNG download', async ({ page }) => {
  await setupGraph(page);

  const download = await captureScreenshot(page, 'Visible Area');
  expect(download.suggestedFilename()).toMatch(/^graph-.*\.png$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const { size } = statSync(path!);
  expect(size).toBeGreaterThan(100);
});

test('screenshot all nodes triggers a PNG download', async ({ page }) => {
  await setupGraph(page);

  const download = await captureScreenshot(page, 'All Nodes');
  expect(download.suggestedFilename()).toMatch(/^graph-.*\.png$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const { size } = statSync(path!);
  expect(size).toBeGreaterThan(100);
});
