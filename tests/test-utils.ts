import { expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getMockResponseForQuery } from './mock-responses';

const mockDir = resolve(__dirname, 'mock');
const queryUrlPattern = /\/query(?:\?.*)?$/;
const sourceUrlPattern = /\/source\/[^/?#]+(?:\?.*)?$/;

const isSourceUrlForFile = (url: string, fileId: string) => {
  const match = url.match(/\/source\/([^/?#]+)(?:\?.*)?$/);
  return match ? match[1] === fileId : false;
};

export const fileContents: Record<string, string> = {
  '1': readFileSync(resolve(mockDir, 'kubelet.go'), 'utf-8'),
  '4': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
  '11': readFileSync(resolve(mockDir, 'logs.go'), 'utf-8'),
  '22': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
};

export async function interceptGraphEndpoints(page: Page) {
  await page.route(queryUrlPattern, async route => {
    const body = route.request().postData() ?? '';
    const mockResponse = getMockResponseForQuery(body);

    if (!mockResponse) {
      await route.fulfill({ status: 404, body: 'Mock query not found' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(mockResponse),
    });
  });

  await page.route(sourceUrlPattern, async route => {
    const url = new URL(route.request().url());
    const fileId = url.pathname.split('/').pop() ?? '';
    const content = fileContents[fileId];

    if (!content) {
      await route.fulfill({ status: 404, body: 'Mock source not found' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*' },
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
  const queryResponse = page.waitForResponse(queryUrlPattern);
  await page.keyboard.press('ControlOrMeta+Enter');
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
  const responsePromise = page.waitForResponse(response => isSourceUrlForFile(response.url(), fileId));
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

type CenteringProbeArgs = {
  fragment: string;
  line: number;
};

type CenteringProbeResult =
  | { status: 'pending'; reason: string }
  | {
      status: 'ready';
      path: string;
      visible: boolean;
      ratio: number;
      startLineNumber: number;
      endLineNumber: number;
    };

export interface LineCenteringOptions {
  minFractionFromEdge?: number;
  timeout?: number;
  message?: string;
}

export async function expectLineRoughlyCentered(
  page: Page,
  filePathFragment: string,
  lineNumber: number,
  options?: LineCenteringOptions,
) {
  const minFractionFromEdge = Math.min(0.4, Math.max(0, options?.minFractionFromEdge ?? 0.2));
  const normalizedFragment = filePathFragment.replace(/\\/g, '/').toLowerCase();
  const normalizedLineNumber = Math.max(1, Math.round(lineNumber));

  const checkResult = async () => {
    const probe = await page.evaluate<CenteringProbeResult, CenteringProbeArgs>(
      ({ fragment, line }) => {
        const monacoInstance = (window as any).monaco;
        if (!monacoInstance?.editor?.getEditors) {
          return { status: 'pending', reason: 'monaco-unavailable' };
        }

        const editors = monacoInstance.editor.getEditors();
        for (const editor of editors) {
          const model = editor.getModel?.();
          if (!model) {
            continue;
          }

          const uri = model.uri;
          const fullPath = (uri?.path ?? uri?.toString() ?? '').replace(/\\/g, '/');
          const normalizedPath = fullPath.toLowerCase();
          if (fragment && !normalizedPath.endsWith(fragment) && !normalizedPath.includes(fragment)) {
            continue;
          }

          const ranges = editor.getVisibleRanges?.();
          if (!ranges || ranges.length === 0) {
            return { status: 'pending', reason: 'no-visible-range' };
          }

          const { startLineNumber, endLineNumber } = ranges[0];
          const visible = line >= startLineNumber && line <= endLineNumber;
          const span = endLineNumber - startLineNumber;
          const ratio = span <= 0 ? 0.5 : (line - startLineNumber) / span;

          return {
            status: 'ready',
            path: fullPath || uri?.toString() || '',
            visible,
            ratio,
            startLineNumber,
            endLineNumber,
          };
        }

        return { status: 'pending', reason: 'editor-not-found' };
      },
      { fragment: normalizedFragment, line: normalizedLineNumber },
    );

    if (probe.status !== 'ready') {
      return `pending:${probe.reason}`;
    }

    if (!probe.visible) {
      return `not-visible:${probe.startLineNumber}-${probe.endLineNumber}`;
    }

    const lowerBound = minFractionFromEdge;
    const upperBound = 1 - minFractionFromEdge;
    if (probe.ratio < lowerBound || probe.ratio > upperBound) {
      return `near-edge:${probe.ratio.toFixed(2)}`;
    }

    return 'ok';
  };

  await expect
    .poll(checkResult, {
      timeout: options?.timeout ?? 5000,
      message: options?.message ?? `line ${normalizedLineNumber} not centered for ${filePathFragment}`,
    })
    .toBe('ok');
}
