import { test, expect } from '@playwright/test';
import { findAllTabSets } from './helpers-flex';

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
  const mockResponse = {
    nodes: [
      {
        id: 'node-1',
        label: 'Node 1',
        declarations: [
          {
            id: 'decl-1',
            symbol: 'symbol1',
            file_id: 'file-1',
            symbol_type: 'Definition',
            line_start: '1',
            col_start: '1',
            line_end: '1',
            col_end: '10'
          }
        ]
      },
      {
        id: 'node-2',
        label: 'Node 2',
        declarations: [
          {
            id: 'decl-2',
            symbol: 'symbol2',
            file_id: 'file-2',
            symbol_type: 'Definition',
            line_start: '2',
            col_start: '1',
            line_end: '2',
            col_end: '10'
          }
        ]
      },
      {
        id: 'node-3',
        label: 'Node 3',
        declarations: [
          {
            id: 'decl-3',
            symbol: 'symbol3',
            file_id: 'file-3',
            symbol_type: 'Definition',
            line_start: '3',
            col_start: '1',
            line_end: '3',
            col_end: '10'
          }
        ]
      }
    ],
    edges: [
      {
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
        from_file: 'file-1',
        from_line: '1'
      },
      {
        id: 'edge-2',
        from: 'node-2',
        to: 'node-3',
        from_file: 'file-2',
        from_line: '2'
      }
    ],
    files: [
      ['file-1', '/path/file1.askl'],
      ['file-2', '/path/file2.askl'],
      ['file-3', '/path/file3.askl']
    ]
  };

  await page.route('**/api/query', async route => {
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

  const queryResponse = page.waitForResponse('**/api/query');
  await page.keyboard.press('Control+Enter');
  await queryResponse;

  await page.waitForFunction(() => {
    const cy = (window as any).__asklCy;
    return cy && cy.nodes().length === 3;
  });

  const nodeCount = await page.evaluate(() => {
    const cy = (window as any).__asklCy;
    return cy ? cy.nodes().length : 0;
  });

  expect(nodeCount).toBe(3);
});
