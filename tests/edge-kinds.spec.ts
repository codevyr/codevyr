import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
  waitForLayoutGen,
} from './test-utils';

// A REAL answer, captured from an engine serving an index that states what
// its references do: `platform_probe` and `__platform_driver_probe` around
// the slot `platform_driver.probe`, from three kernel translation units.
// One picture holds every line the graph draws: a call, a call that is also
// a read, a write, a function taken as a value, a slot holding a function,
// references that state nothing, and a type containing its field.
const captured = JSON.parse(
  readFileSync(resolve(__dirname, 'mock', 'edge-kinds.json'), 'utf-8'),
) as {
  query: string;
  skeleton: {
    nodes: Array<{ id: string; label: string }>;
    edges: Array<{ from: string; to: string; kinds?: string[]; refers?: boolean }>;
  };
  occurrences: Record<string, { rows: Array<{ ref_id: string; kinds?: string[] }>; next: null }>;
};

/** The id of a node of the captured answer, by its label. */
function id(label: string): string {
  const node = captured.skeleton.nodes.find((n) => n.label === label);
  if (!node) throw new Error(`no node ${label} in the captured answer`);
  return node.id;
}

function edge(from: string, to: string): string {
  return `${id(from)}-${id(to)}`;
}

async function serve(page: Page, skeleton: unknown) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(skeleton),
    });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ rows: [], next: null, total: 0 }),
    });
  });
  await page.route('**/v1/edge/**/occurrences**', async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /\/v1\/edge\/([^/]+)\/([^/]+)\/occurrences/,
    );
    const rows = match ? captured.occurrences[`${match[1]}-${match[2]}`] : undefined;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(rows ?? { rows: [], next: null }),
    });
  });
  await page.route('**/source/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/plain', body: '\n' });
  });
}

async function draw(page: Page, skeleton: unknown) {
  await serve(page, skeleton);
  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, captured.query);
  await submitQuery(page);
  await waitForGraphNodeCount(page, captured.skeleton.nodes.length);
  await ensureGraphApis(page);
  await waitForLayoutGen(page, 1);
  await page.waitForTimeout(300);
}

/** How one edge is drawn: its dash pattern, its stroke, its label. */
async function drawn(page: Page, edgeId: string) {
  const group = page.locator(`[data-testid="graph-edge-${edgeId}"]`);
  await expect(group).toBeAttached();
  const path = group.locator('.react-flow__edge-path');
  const label = page.locator(`[data-testid="graph-edge-label-${edgeId}"]`);
  return {
    dash: await path.evaluate((el) => (el as SVGPathElement).style.strokeDasharray),
    stroke: await path.evaluate((el) => (el as SVGPathElement).style.stroke),
    label: (await label.count()) > 0 ? await label.textContent() : null,
  };
}

/** Where a test should save the picture it takes, if anywhere. */
const pictureDir = process.env.EDGE_KINDS_PICTURES;

// Room for the whole picture: the graph pane is a part of the window.
test.use({ viewport: { width: 1500, height: 950 } });

test.describe('the graph draws what an edge does', () => {
  test('a call, a use, a relation and an unstated reference are each drawn their own way', async ({
    page,
  }) => {
    await draw(page, captured.skeleton);

    // A plain call: a solid line in the call's colour, and no word on it.
    expect(await drawn(page, edge('platform_probe', 'dev_pm_domain_attach'))).toEqual({
      dash: '',
      stroke: 'var(--graph-edge-call-color)',
      label: null,
    });
    // The slot is called through AND read (tested before the call): the
    // line is the call's, and the label says both.
    expect(await drawn(page, edge('platform_probe', 'platform_driver.probe'))).toEqual({
      dash: '',
      stroke: 'var(--graph-edge-call-color)',
      label: 'calls, reads',
    });
    // Not a call: who assigns the slot, and who hands a function on.
    expect(await drawn(page, edge('__platform_driver_probe', 'platform_driver.probe'))).toEqual({
      dash: '7, 5',
      stroke: 'var(--graph-edge-use-color)',
      label: 'writes',
    });
    expect(await drawn(page, edge('platform_probe', 'platform_probe_fail'))).toEqual({
      dash: '7, 5',
      stroke: 'var(--graph-edge-use-color)',
      label: 'takes',
    });
    // A relation no token spells: the slot holds the function.
    expect(await drawn(page, edge('platform_driver.probe', 'bt_bmc_probe'))).toEqual({
      dash: '1, 6',
      stroke: 'var(--graph-edge-relation-color)',
      label: '⇢ holds',
    });
    // Nothing stated (a type, a macro): the edge as it always was.
    expect(await drawn(page, edge('platform_probe', 'to_platform_driver'))).toEqual({
      dash: '',
      stroke: 'var(--graph-edge-color)',
      label: null,
    });

    // The legend names the lines this graph draws, in the report's words.
    const legend = page.locator('[data-testid="graph-legend"]');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.graph-legend-row')).toHaveText([
      'calls',
      'takes, reads or writes',
      '↦ declares, ⇢ holds',
      '→ refers to, nothing more stated',
      '▸ contains: a box inside a box',
    ]);

    if (pictureDir) {
      await page.locator('.react-flow').screenshot({ path: resolve(pictureDir, 'after.png') });
    }
  });

  test('the edge menu says every relationship of the pair, and what each site does', async ({
    page,
  }) => {
    await draw(page, captured.skeleton);

    const edgeId = edge('platform_probe', 'platform_driver.probe');
    // A click on the edge opens its menu (the edge has three sites, so there
    // is one to choose).  Dispatched on the edge itself: where its curve runs
    // depends on the layout, and a node may lie over its middle.
    await page.locator(`[data-testid="graph-edge-${edgeId}"]`).dispatchEvent('click');

    const menu = page.locator(`[data-testid="context-menu-edge-${edgeId}"]`);
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-testid="edge-hover-relationships"]')).toHaveText(
      'Is→ refers to: calls, reads',
    );
    // Three sites: two test the slot, one calls through it.
    const sites = captured.occurrences[edgeId].rows;
    expect(sites.map((row) => row.kinds)).toEqual([['reads'], ['reads'], ['calls']]);
    for (const row of sites) {
      await expect(page.locator(`[data-testid="edge-occurrence-does-${row.ref_id}"]`)).toHaveText(
        ` · ${row.kinds!.join(', ')}`,
      );
    }

    if (pictureDir) {
      await page.screenshot({ path: resolve(pictureDir, 'after-menu.png') });
    }
  });

  test('an answer that states nothing is drawn as it always was', async ({ page }) => {
    // The same answer as an index written before references said anything
    // sends it: no `kinds`, no `refers`.
    const silent = {
      ...captured.skeleton,
      edges: captured.skeleton.edges.map(({ kinds: _kinds, refers: _refers, ...rest }) => rest),
    };
    await draw(page, silent);

    for (const e of captured.skeleton.edges) {
      expect(await drawn(page, `${e.from}-${e.to}`)).toEqual({
        dash: '',
        stroke: 'var(--graph-edge-color)',
        label: null,
      });
    }
    await expect(page.locator('[data-testid="graph-legend"]')).toHaveCount(0);
    await expect(page.locator('.graph-edge-label')).toHaveCount(0);

    if (pictureDir) {
      await page.locator('.react-flow').screenshot({ path: resolve(pictureDir, 'unstated.png') });
    }
  });
});
