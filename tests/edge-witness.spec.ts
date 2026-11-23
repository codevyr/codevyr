import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
  waitForLayoutGen,
  skeletonFromFixture,
} from './test-utils';

// AN OCCURRENCE IS SHOWN WHERE IT HAPPENED: at its witness when it has one,
// at its own place otherwise.
//
// A slot and two functions it holds, as an ops table gives them: the rows of
// `slot ⇢ drv_read` and `slot ⇢ other_read` both lie on the field in
// the header, the same line for every function the slot holds.  Where each
// was made so is its witness: the store in the driver.  Beside them an
// ordinary call, whose own place is where it happened.
const HEADER = 'struct ops {\n    int (*read)(void);\n};\n';
const DRIVER =
  'static int drv_read(void) { return 0; }\n' +
  '\n' +
  'static struct ops drv_ops = {\n' +
  '    .read = drv_read,\n' +
  '};\n';
const OTHER = '\n\n\n\n\nstatic struct ops other_ops = { .read = other_read };\n';
const CALLER = 'int caller(void)\n{\n    return drv_read();\n}\n';

const SOURCES: Record<string, string> = {
  obj_header: HEADER,
  obj_driver: DRIVER,
  obj_other: OTHER,
  obj_caller: CALLER,
};

const FIELD_SPAN = { start_offset: HEADER.indexOf('int (*read)'), end_offset: HEADER.indexOf(';\n}') };
const span = (text: string, needle: string) => ({
  start_offset: text.indexOf(needle),
  end_offset: text.indexOf(needle) + needle.length,
});

const node = (id: string, object: string) => ({
  id,
  label: id,
  symbol_instances: [
    { id: `si_${id}`, symbol: id, object_id: object, symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
  ],
});

const graphResponse = {
  nodes: [
    node('slot', 'obj_header'),
    node('drv_read', 'obj_driver'),
    node('other_read', 'obj_other'),
    node('caller', 'obj_caller'),
  ],
  edges: [
    { id: 'slot-drv_read', from: 'slot', to: 'drv_read', occurrence_count: 1, kinds: ['holds'], refers: false },
    { id: 'slot-other_read', from: 'slot', to: 'other_read', occurrence_count: 1, kinds: ['holds'], refers: false },
    { id: 'caller-drv_read', from: 'caller', to: 'drv_read', occurrence_count: 1, kinds: ['calls'], refers: true },
  ],
  has_edges: [],
  objects: [
    { object_id: 'obj_header', path: 'mock/ops.h' },
    { object_id: 'obj_driver', path: 'mock/drv.c' },
    { object_id: 'obj_other', path: 'mock/other.c' },
    { object_id: 'obj_caller', path: 'mock/caller.c' },
  ],
  warnings: [],
};

const OCCURRENCES: Record<string, unknown> = {
  'slot-drv_read': {
    ref_id: 'h1',
    from_instance_id: 'si_slot',
    object_id: 'obj_header',
    path: 'mock/ops.h',
    project_id: null,
    ...FIELD_SPAN,
    kinds: ['holds'],
    witness: { object_id: 'obj_driver', path: 'mock/drv.c', ...span(DRIVER, '.read = drv_read'), sites: 1 },
  },
  'slot-other_read': {
    ref_id: 'h2',
    from_instance_id: 'si_slot',
    object_id: 'obj_header',
    path: 'mock/ops.h',
    project_id: null,
    ...FIELD_SPAN,
    kinds: ['holds'],
    witness: { object_id: 'obj_other', path: 'mock/other.c', ...span(OTHER, '.read = other_read'), sites: 8 },
  },
  'caller-drv_read': {
    ref_id: 'c1',
    from_instance_id: 'si_caller',
    object_id: 'obj_caller',
    path: 'mock/caller.c',
    project_id: null,
    ...span(CALLER, 'drv_read'),
    kinds: ['calls'],
  },
};

async function intercept(page: Page) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(skeletonFromFixture(graphResponse as any)),
    });
  });
  await page.route('**/v1/symbol/**/instances**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: [], next: null, total: 0 }),
    });
  });
  await page.route('**/v1/edge/**/occurrences**', async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /\/v1\/edge\/([^/]+)\/([^/]+)\/occurrences/,
    );
    const row = match ? OCCURRENCES[`${decodeURIComponent(match[1])}-${decodeURIComponent(match[2])}`] : undefined;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: row ? [row] : [], next: null }),
    });
  });
  await page.route('**/source/**', async (route) => {
    const object = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    await route.fulfill({ status: 200, contentType: 'text/plain', body: SOURCES[object] ?? '\n' });
  });
}

async function draw(page: Page) {
  await intercept(page);
  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, '"slot" {};');
  await submitQuery(page);
  await waitForGraphNodeCount(page, 4);
  await ensureGraphApis(page);
  await waitForLayoutGen(page, 1);
  await page.waitForTimeout(300);
}

/** The cursor of the code viewer showing `object`, once it shows it. */
async function cursorIn(page: Page, object: string, path: string) {
  await expect(page.locator(`[data-testid="code-viewer"][data-file-id="${object}"]`)).toBeVisible();
  const position = () =>
    page.evaluate((fragment) => {
      const editors = (window as any).monaco?.editor?.getEditors?.() ?? [];
      for (const editor of editors) {
        const uri = editor.getModel?.()?.uri;
        if (uri && String(uri.path ?? uri).includes(fragment)) {
          const at = editor.getPosition?.();
          return at ? `${at.lineNumber}:${at.column}` : null;
        }
      }
      return null;
    }, path);
  return position;
}

/** A click on the edge itself: where its curve runs depends on the layout. */
async function clickEdge(page: Page, edgeId: string) {
  await page.locator(`[data-testid="graph-edge-${edgeId}"]`).dispatchEvent('click');
}

async function openMenu(page: Page, edgeId: string) {
  await page
    .locator(`[data-testid="graph-edge-${edgeId}"]`)
    .dispatchEvent('contextmenu', { bubbles: true, clientX: 400, clientY: 300 });
  const menu = page.locator(`[data-testid="context-menu-edge-${edgeId}"]`);
  await expect(menu).toBeVisible();
  return menu;
}

test.describe('an edge opens where it happened', () => {
  test('a relation opens at its witness, not on the declaration its row lies on', async ({ page }) => {
    await draw(page);

    // One occurrence: the click goes straight there.  The store is on line 4
    // of the driver; the row itself lies on line 2 of the header.
    await clickEdge(page, 'slot-drv_read');
    const position = await cursorIn(page, 'obj_driver', 'mock/drv.c');
    await expect.poll(position).toBe('4:5');
    await expect(page.locator('[data-testid="code-viewer"][data-file-id="obj_header"]')).toHaveCount(0);
  });

  test('a reference opens where it always did', async ({ page }) => {
    await draw(page);

    await clickEdge(page, 'caller-drv_read');
    const position = await cursorIn(page, 'obj_caller', 'mock/caller.c');
    await expect.poll(position).toBe('3:12');
  });

  test('the edge menu lists the witness, and says it is the first of several', async ({ page }) => {
    await draw(page);

    const menu = await openMenu(page, 'slot-other_read');
    const row = menu.locator('[data-testid="edge-occurrence-h2"]');
    await expect(row).toBeVisible();
    // The path and the line of the store, not of the field.
    await expect(row.locator('td').nth(0)).toHaveText('mock/other.c');
    await expect(row.locator('td').nth(1)).toHaveText('6:33 · ⇢ holds · first of 8');
    await expect(row.locator('[data-testid="edge-occurrence-sites-h2"]')).toHaveText(' · first of 8');

    // The row opens the witness too.
    await row.click();
    const position = await cursorIn(page, 'obj_other', 'mock/other.c');
    await expect.poll(position).toBe('6:33');
  });

  test('the only place is not counted, and a reference has no count', async ({ page }) => {
    await draw(page);

    const held = await openMenu(page, 'slot-drv_read');
    await expect(held.locator('[data-testid="edge-occurrence-h1"] td').nth(0)).toHaveText('mock/drv.c');
    await expect(held.locator('[data-testid="edge-occurrence-h1"] td').nth(1)).toHaveText('4:5 · ⇢ holds');
    await page.keyboard.press('Escape');

    const called = await openMenu(page, 'caller-drv_read');
    await expect(called.locator('[data-testid="edge-occurrence-c1"] td').nth(0)).toHaveText('mock/caller.c');
    await expect(called.locator('[data-testid="edge-occurrence-c1"] td').nth(1)).toHaveText('3:12 · calls');
    await expect(page.locator('[data-testid^="edge-occurrence-sites-"]')).toHaveCount(0);
  });
});
