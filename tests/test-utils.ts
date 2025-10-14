import { expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getMockResponseForQuery } from './mock-responses';

const mockDir = resolve(__dirname, 'mock');

export const fileContents: Record<string, string> = {
  '1': readFileSync(resolve(mockDir, 'kubelet.go'), 'utf-8'),
  '4': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
  '11': readFileSync(resolve(mockDir, 'logs.go'), 'utf-8'),
  '22': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
};

export async function interceptGraphEndpoints(page: Page) {
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
      body: JSON.stringify(mockResponse),
    });
  });

  await page.route('**/api/source/*', async route => {
    const url = route.request().url();
    const fileId = url.split('/').pop() ?? '';
    const content = fileContents[fileId];

    if (!content) {
      await route.fulfill({ status: 404, body: 'Mock source not found' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: content,
    });
  });
}

export async function loadApp(page: Page) {
  await page.goto('./');
  await page.waitForLoadState('networkidle');
}

export async function ensureEditorApis(page: Page) {
  await page.waitForFunction(() => {
    const win = window as any;
    return typeof win.__asklSetQuery === 'function' && typeof win.__asklGetQuery === 'function';
  });
}

export async function setEditorQuery(page: Page, query: string) {
  await ensureEditorApis(page);
  await page.evaluate(value => {
    const setQuery = (window as any).__asklSetQuery;
    setQuery?.(value);
  }, query);

  const activeQuery = await page.evaluate(() => {
    const getQuery = (window as any).__asklGetQuery;
    return getQuery ? getQuery() : null;
  });

  expect(activeQuery).toBe(query);
}

export async function submitQuery(page: Page) {
  const submitShortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  const queryResponse = page.waitForResponse('**/api/query');
  await page.keyboard.press(submitShortcut);
  await queryResponse;
}

export async function waitForGraphNodeCount(page: Page, expectedCount: number) {
  await page.waitForFunction(count => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    return el?.getAttribute('data-node-count') === String(count);
  }, expectedCount);
}

export async function ensureGraphApis(page: Page) {
  await page.waitForFunction(() => {
    const win = window as any;
    return typeof win.__asklTapNode === 'function' && typeof win.__asklTapEdge === 'function';
  });
}

export async function tapGraphNodeAndWaitForSource(page: Page, nodeId: string, fileId: string) {
  const responsePromise = page.waitForResponse(response => response.url().includes(`/api/source/${fileId}`));
  await page.evaluate(id => {
    const tapNode = (window as any).__asklTapNode;
    tapNode?.(id);
  }, nodeId);
  await responsePromise;
}

export async function tapGraphEdge(page: Page, edgeId: string) {
  await page.evaluate(id => {
    const tapEdge = (window as any).__asklTapEdge;
    tapEdge?.(id);
  }, edgeId);
}

export async function waitForPopper(page: Page, id: string) {
  await page.waitForFunction(testId => {
    return document.querySelector(`[data-testid="${testId}"]`) !== null;
  }, id);
}

export async function waitForPopperToClose(page: Page, id: string) {
  await page.waitForFunction(testId => {
    return document.querySelector(`[data-testid="${testId}"]`) === null;
  }, id);
}
