import { expect, Locator, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getMockEdgeOccurrences, getMockResponseForQuery, SUBMIT_QUERY } from './mock-responses';

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

let lastQueryBody = '';

export async function interceptGraphEndpoints(page: Page) {
  // `/query` ships edges as (from, to) pairs + a count; call sites come from
  // this endpoint when an edge is opened or clicked.
  await page.route('**/v1/edge/**/occurrences**', async route => {
    const match = new URL(route.request().url()).pathname.match(
      /\/v1\/edge\/([^/]+)\/([^/]+)\/occurrences/,
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        match ? getMockEdgeOccurrences(match[1], match[2]) : { rows: [], next: null },
      ),
    });
  });

  await page.route(queryUrlPattern, async route => {
    const body = route.request().postData() ?? '';
    lastQueryBody = body;
    const mockResponse = getMockResponseForQuery(body);

    if (!mockResponse) {
      await route.fulfill({ status: 404, body: 'Mock query not found' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(skeletonFromFixture(mockResponse as never)),
    });
  });

  // The same fixture answers the instances endpoint the hover now uses.
  await page.route('**/v1/symbol/**/instances**', async route => {
    const m = new URL(route.request().url()).pathname.match(/\/v1\/symbol\/([^/]+)\/instances/);
    const fixture = getMockResponseForQuery(lastQueryBody) as never;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        fixture && m ? instancesFromFixture(fixture, m[1]) : { rows: [], next: null, total: 0 },
      ),
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

export async function loadApp(page: Page, { mockProjects = true } = {}) {
  if (mockProjects) {
    // Return empty project list to suppress "Failed to load projects" errors.
    // Tests that provide their own project data should pass { mockProjects: false }.
    await page.route('**/v1/index/projects**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([]),
      });
    });
  }
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

export async function waitForLayoutGen(page: Page, minGen: number) {
  await page.waitForFunction((gen) => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    const current = el?.getAttribute('data-layout-gen');
    return current !== null && Number(current) >= gen;
  }, minGen);
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

export async function waitForContextMenu(page: Page, id: string) {
  await page.waitForFunction(testId => {
    return document.querySelector(`[data-testid="${testId}"]`) !== null;
  }, id);
}

export async function waitForContextMenuToClose(page: Page, id: string) {
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

export async function setupGraph(page: Page) {
  await interceptGraphEndpoints(page);
  await loadApp(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, SUBMIT_QUERY);
  await submitQuery(page);
  await waitForGraphNodeCount(page, 3);
  await ensureGraphApis(page);
  await waitForLayoutGen(page, 1);
  await page.waitForTimeout(300);
}

export function toolbarButton(page: Page, label: string): Locator {
  return page.locator('.toolbar-btn', { hasText: label });
}

// --- skeleton conversion -----------------------------------------------
//
// Specs declare fixtures the readable way — nodes WITH their instances —
// while the wire now carries a skeleton (relationships only) plus detail
// endpoints. Rather than restate every fixture, convert at the boundary:
// the skeleton is derived here, and the same instances are served back from
// the instances endpoint. One fixture, both shapes, no duplication.

type FixtureInstance = {
  id: string;
  symbol?: string;
  object_id: string;
  project_id?: string;
  symbol_type?: string;
  instance_type: string;
  start_offset: number;
  end_offset: number;
};

type FixtureNode = {
  id: string;
  label: string;
  symbol_instances?: FixtureInstance[];
  color?: string;
  query_statements?: Array<{ start: number; end: number; text: string }>;
};

type FixtureGraph = {
  nodes: FixtureNode[];
  edges?: Array<Record<string, unknown>>;
  has_edges?: Array<{ parent: string; child: string }>;
  objects?: Array<{ object_id: string; path: string; project_id?: string }>;
  warnings?: unknown[];
  edges_truncated?: string[];
};

const DIRECTORY_INSTANCE_TYPES = new Set(['sentinel', 'containment']);

/** Derive the skeleton the server would send for a fixture graph. */
export function skeletonFromFixture(fixture: FixtureGraph) {
  const pairs = new Map<string, { from: string; to: string; count: number }>();
  for (const edge of fixture.edges ?? []) {
    const from = String(edge.from);
    const to = String(edge.to);
    const key = `${from}-${to}`;
    const existing = pairs.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      pairs.set(key, { from, to, count: Number(edge.occurrence_count ?? 1) });
    }
  }

  return {
    nodes: fixture.nodes.map((node) => {
      const instances = node.symbol_instances ?? [];
      return {
        id: node.id,
        symbol_ids: [node.id],
        label: node.label,
        symbol_type: instances[0]?.symbol_type ?? 'Function',
        is_directory:
          instances.length > 0 && instances.every((i) => DIRECTORY_INSTANCE_TYPES.has(i.instance_type)),
        instance_count: instances.length,
        parent_symbol:
          (fixture.has_edges ?? []).find((he) => he.child === node.id)?.parent ?? null,
        query_statements: node.query_statements ?? [],
        ...(node.color ? { color: node.color } : {}),
      };
    }),
    edges: Array.from(pairs.values()).map((p) => ({
      from: p.from,
      to: p.to,
      from_symbol: p.from,
      to_symbol: p.to,
      occurrence_count: p.count,
    })),
    has_edges: (fixture.has_edges ?? []).map((he) => ({ parent: he.parent, child: he.child })),
    warnings: fixture.warnings ?? [],
    truncated: false,
    total_symbols: fixture.nodes.length,
    edges_truncated: fixture.edges_truncated ?? [],
  };
}

/** Serve a fixture's instances back through the instances endpoint. */
function instancesFromFixture(fixture: FixtureGraph, symbolId: string) {
  const node = fixture.nodes.find((n) => n.id === symbolId);
  const pathOf = (objectId: string) =>
    fixture.objects?.find((o) => o.object_id === objectId)?.path ?? `mock/${objectId}`;
  const rows = (node?.symbol_instances ?? []).map((inst) => ({
    id: inst.id,
    instance_type: inst.instance_type,
    object_id: inst.object_id,
    path: pathOf(inst.object_id),
    project_id: inst.project_id ?? '1',
    start_offset: inst.start_offset,
    end_offset: inst.end_offset,
  }));
  return { rows, next: null, total: rows.length };
}

/**
 * Serve a fixture graph across every endpoint the client now uses: the
 * skeleton from `/query`, instances per node, and (empty) edge occurrences.
 */
export async function interceptFixtureGraph(page: Page, fixture: FixtureGraph) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(skeletonFromFixture(fixture)),
    });
  });

  await page.route('**/v1/symbol/**/instances**', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/v1\/symbol\/([^/]+)\/instances/);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        match ? instancesFromFixture(fixture, match[1]) : { rows: [], next: null, total: 0 },
      ),
    });
  });

  await page.route('**/v1/edge/**/occurrences**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ rows: [], next: null }),
    });
  });

  await page.route('**/source/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'package main\n' });
  });
}
