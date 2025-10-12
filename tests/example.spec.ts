import { test, expect } from '@playwright/test';
import { findAllTabSets } from './helpers';

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
