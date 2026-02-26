import { Page } from '@playwright/test';

export const findAllTabSets = (page: Page) => {
  return page.locator('.flexlayout__tabset');
};
