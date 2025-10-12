import { test, expect } from '@playwright/test';
import { findAllTabSets } from './helpers-flex';
import { getMockResponseForQuery, SUBMIT_QUERY } from './mock-responses';

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
  await page.route('**/api/query', async route => {
    const body = route.request().postData() ?? '';
    const mockResponse = getMockResponseForQuery(body);

    if (!mockResponse) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockResponse)
    });
  });

  await page.goto('./');
  await page.waitForLoadState('networkidle');

  const editor = page.locator('.monaco-editor');
  await editor.click();

  await page.waitForFunction(() => {
    const win = window as any;
    return typeof win.__asklSetQuery === 'function' && typeof win.__asklGetQuery === 'function';
  });

  await page.evaluate((query) => {
    const setQuery = (window as any).__asklSetQuery;
    setQuery?.(query);
  }, SUBMIT_QUERY);

  const activeQuery = await page.evaluate(() => {
    const getQuery = (window as any).__asklGetQuery;
    return getQuery ? getQuery() : null;
  });

  expect(activeQuery).toBe(SUBMIT_QUERY);

  const submitShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

  const queryResponse = page.waitForResponse('**/api/query');
  await page.keyboard.press(submitShortcut);
  await queryResponse;

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    return el?.getAttribute('data-node-count') === '3';
  });

  await expect(page.locator('[data-testid="graph-metadata"]')).toHaveAttribute('data-node-count', '3');
});
