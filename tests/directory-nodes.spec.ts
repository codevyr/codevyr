import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  tapGraphNodeAndWaitForSource,
  waitForGraphNodeCount,
  waitForContextMenu,
} from './test-utils';

const PROJECT_ID = '10';
const PROJECT = {
  id: PROJECT_ID,
  project_name: 'kueue',
  root_path: '/kueue',
};

const fileContents: Record<string, string> = {
  obj_main_go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}\n',
};

const fileIdToPath: Record<string, string> = {
  obj_main_go: '/kueue/cmd/kueue/main.go',
  obj_cmd_kueue_dir: '/kueue/cmd/kueue',
  obj_root_dir: '/',
};

const treeNodes: Record<string, Array<{
  name: string;
  path: string;
  node_type: 'dir' | 'file';
  has_children: boolean;
  file_id?: string;
  filetype?: string;
  compact_path?: string;
}>> = {
  '/': [
    {
      name: 'kueue',
      path: '/kueue',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/kueue': [
    {
      name: 'cmd',
      path: '/kueue/cmd',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/kueue/cmd': [
    {
      name: 'kueue',
      path: '/kueue/cmd/kueue',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/kueue/cmd/kueue': [
    {
      name: 'main.go',
      path: '/kueue/cmd/kueue/main.go',
      node_type: 'file',
      has_children: false,
      file_id: 'obj_main_go',
      filetype: 'text/x-go',
    },
  ],
};

// Graph response with directory nodes, has_edges, and regular nodes.
//
// Structure:
//   dir_root ("/")          — standalone directory (only Directory instances, no has_edges children)
//   dir_cmd_kueue ("/kueue/cmd/kueue") — group directory (has_edges parent of file_main_go)
//     file_main_go ("/kueue/cmd/kueue/main.go") — file node (parent = dir_cmd_kueue)
//       func_main ("main")  — function node (parent = file_main_go)
const graphResponse = {
  nodes: [
    {
      id: 'dir_root',
      label: '/',
      symbol_instances: [
        {
          id: 'si_root_self',
          symbol: 'dir_root',
          object_id: 'obj_root_dir',
          project_id: PROJECT_ID,
          symbol_type: 'Directory',
          instance_type: 'sentinel',
          start_offset: 1,
          end_offset: 0,
        },
      ],
    },
    {
      id: 'dir_cmd_kueue',
      label: '/kueue/cmd/kueue',
      symbol_instances: [
        {
          id: 'si_cmd_kueue_containment',
          symbol: 'dir_cmd_kueue',
          object_id: 'obj_main_go',
          project_id: PROJECT_ID,
          symbol_type: 'Directory',
          instance_type: 'containment',
          start_offset: 0,
          end_offset: 76,
        },
        {
          id: 'si_cmd_kueue_self',
          symbol: 'dir_cmd_kueue',
          object_id: 'obj_cmd_kueue_dir',
          project_id: PROJECT_ID,
          symbol_type: 'Directory',
          instance_type: 'sentinel',
          start_offset: 1,
          end_offset: 0,
        },
      ],
    },
    {
      id: 'file_main_go',
      label: '/kueue/cmd/kueue/main.go',
      symbol_instances: [
        {
          id: 'si_file_main',
          symbol: 'file_main_go',
          object_id: 'obj_main_go',
          project_id: PROJECT_ID,
          symbol_type: 'File',
          instance_type: 'source',
          start_offset: 0,
          end_offset: 76,
        },
      ],
    },
    {
      id: 'func_main',
      label: 'main',
      symbol_instances: [
        {
          id: 'si_func_main',
          symbol: 'func_main',
          object_id: 'obj_main_go',
          project_id: PROJECT_ID,
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: 28,
          end_offset: 76,
        },
      ],
    },
  ],
  edges: [],
  has_edges: [
    { id: 'has-dir_cmd_kueue-file_main_go', parent: 'dir_cmd_kueue', child: 'file_main_go' },
    { id: 'has-file_main_go-func_main', parent: 'file_main_go', child: 'func_main' },
  ],
  objects: [
    { object_id: 'obj_main_go', path: '/kueue/cmd/kueue/main.go', project_id: PROJECT_ID },
    { object_id: 'obj_cmd_kueue_dir', path: '/kueue/cmd/kueue', project_id: PROJECT_ID },
    { object_id: 'obj_root_dir', path: '/', project_id: PROJECT_ID },
  ],
  warnings: [],
};

const QUERY = '"main" {};';

async function interceptEndpoints(page: Page) {
  await page.route('**/v1/index/projects', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([PROJECT]),
    });
  });

  await page.route(`**/v1/index/projects/${PROJECT_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...PROJECT,
        modules: 1,
        file_count: 5,
        symbol_count: 20,
      }),
    });
  });

  await page.route(`**/v1/index/projects/${PROJECT_ID}/tree**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '/';
    const expand = url.searchParams.getAll('expand[]');
    const expanded: Record<string, typeof treeNodes['/']> = {};
    expand.forEach((expandPath) => {
      expanded[expandPath] = treeNodes[expandPath] ?? [];
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        base_path: path,
        nodes: treeNodes[path] ?? [],
        expanded,
      }),
    });
  });

  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graphResponse),
    });
  });

  await page.route('**/source/**', async (route) => {
    const url = new URL(route.request().url());
    const fileId = url.pathname.split('/').pop() ?? '';
    const content = fileContents[fileId];
    await route.fulfill({
      status: content ? 200 : 404,
      contentType: 'text/plain',
      body: content ?? 'not found',
    });
  });
}

async function setupAndSubmitQuery(page: Page) {
  await interceptEndpoints(page);
  await loadApp(page, { mockProjects: false });
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, QUERY);
  await submitQuery(page);
  await waitForGraphNodeCount(page, 4);
  await ensureGraphApis(page);
}

test.describe('directory node click behavior', () => {
  test('clicking a directory group node reveals it in the tree without opening a file', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Click the directory group node (dir_cmd_kueue).
    // It should NOT trigger a source file fetch — verify by checking that
    // no code-viewer for the directory's fake file opens.
    await page.evaluate(() => {
      (window as any).__asklTapNode?.('dir_cmd_kueue');
    });

    // The explorer should reveal the directory path.
    const dirNode = page.locator(
      '[data-testid="explorer-node"][data-path="/kueue/cmd/kueue"]',
    );
    await expect(dirNode).toBeVisible({ timeout: 5000 });

    // No code-viewer tab should open for the directory's self-ref object.
    await expect(
      page.locator('[data-testid="code-viewer"][data-file-id="obj_cmd_kueue_dir"]'),
    ).not.toBeVisible();
  });

  test('clicking a directory node again after collapsing in tree re-expands it', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // First click — reveals the directory in the tree.
    await page.evaluate(() => {
      (window as any).__asklTapNode?.('dir_cmd_kueue');
    });

    const dirNode = page.locator(
      '[data-testid="explorer-node"][data-path="/kueue/cmd/kueue"]',
    );
    await expect(dirNode).toBeVisible({ timeout: 5000 });

    // The directory's child (main.go) should be visible.
    const childNode = page.locator(
      '[data-testid="explorer-node"][data-path="/kueue/cmd/kueue/main.go"]',
    );
    await expect(childNode).toBeVisible({ timeout: 5000 });

    // Collapse the directory in the tree by clicking it.
    await dirNode.click();
    await expect(childNode).not.toBeVisible();

    // Click the graph node again — should re-expand the directory.
    await page.evaluate(() => {
      (window as any).__asklTapNode?.('dir_cmd_kueue');
    });

    await expect(dirNode).toBeVisible({ timeout: 5000 });
    await expect(childNode).toBeVisible({ timeout: 5000 });
  });

  test('clicking a standalone directory node reveals it in the tree without opening a file', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Click the standalone "/" directory node (dir_root).
    await page.evaluate(() => {
      (window as any).__asklTapNode?.('dir_root');
    });

    // No code viewer should open for the root directory.
    await expect(
      page.locator('[data-testid="code-viewer"][data-file-id="obj_root_dir"]'),
    ).not.toBeVisible();
  });

  test('clicking a directory node after opening a file reveals the directory in the tree', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // First, open a file by clicking the function node.
    await tapGraphNodeAndWaitForSource(page, 'func_main', 'obj_main_go');
    await expect(
      page.locator('[data-testid="code-viewer"][data-file-id="obj_main_go"]'),
    ).toBeVisible();

    // Now click a directory node — the tree should jump to reveal it.
    await page.evaluate(() => {
      (window as any).__asklTapNode?.('dir_cmd_kueue');
    });

    const dirNode = page.locator(
      '[data-testid="explorer-node"][data-path="/kueue/cmd/kueue"]',
    );
    await expect(dirNode).toBeVisible({ timeout: 5000 });
  });

  test('clicking a regular function node still opens its file in the editor', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Click the function node — should open the source file.
    await tapGraphNodeAndWaitForSource(page, 'func_main', 'obj_main_go');

    await expect(
      page.locator('[data-testid="code-viewer"][data-file-id="obj_main_go"]'),
    ).toBeVisible();
    await expect(page.locator('.monaco-editor').last()).toContainText('func main()');
  });
});

test.describe('directory node context menu', () => {
  test('directory group node context menu does not show self-reference @1 rows', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Right-click the directory group node header to open context menu.
    // Use the header element directly since child nodes overlap the group node body.
    const dirHeader = page.locator('[data-testid="graph-node-dir_cmd_kueue"] .graph-group-node-header');
    await dirHeader.click({ button: 'right' });
    await waitForContextMenu(page, 'context-menu-node-dir_cmd_kueue');

    const contextMenu = page.locator('[data-testid="context-menu-node-dir_cmd_kueue"]');

    // The context menu should show the directory label.
    await expect(contextMenu.locator('.node-hover-title')).toContainText('/kueue/cmd/kueue');

    // Should NOT show the confusing @1 self-reference row.
    await expect(contextMenu).not.toContainText('@1');

    // Should show a "Reveal in tree" button.
    await expect(
      contextMenu.locator('button[title="Reveal in tree"]'),
    ).toBeVisible();
  });

  test('directory context menu "Reveal in tree" button reveals directory in explorer', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Open context menu for the directory group node via header.
    const dirHeader = page.locator('[data-testid="graph-node-dir_cmd_kueue"] .graph-group-node-header');
    await dirHeader.click({ button: 'right' });
    await waitForContextMenu(page, 'context-menu-node-dir_cmd_kueue');

    // Click the "Reveal in tree" button.
    const revealBtn = page.locator(
      '[data-testid="context-menu-node-dir_cmd_kueue"] button[title="Reveal in tree"]',
    );
    await revealBtn.click();

    // The explorer should show the directory.
    const dirTreeNode = page.locator(
      '[data-testid="explorer-node"][data-path="/kueue/cmd/kueue"]',
    );
    await expect(dirTreeNode).toBeVisible({ timeout: 5000 });
  });

  test('regular node context menu is unchanged (no reveal button, shows file location)', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Right-click the function node.
    const funcNodeEl = page.locator('[data-testid="graph-node-func_main"]');
    await funcNodeEl.click({ button: 'right' });
    await waitForContextMenu(page, 'context-menu-node-func_main');

    const contextMenu = page.locator('[data-testid="context-menu-node-func_main"]');

    // Should show the function label.
    await expect(contextMenu.locator('.node-hover-title')).toContainText('main');

    // Should show the file path.
    await expect(contextMenu).toContainText('/kueue/cmd/kueue/main.go');

    // Should NOT have a "Reveal in tree" button (not a directory node).
    await expect(
      contextMenu.locator('button[title="Reveal in tree"]'),
    ).not.toBeVisible();
  });

  test('standalone directory node context menu shows directory path', async ({ page }) => {
    await setupAndSubmitQuery(page);

    // Right-click the standalone "/" directory node.
    const rootNodeEl = page.locator('[data-testid="graph-node-dir_root"]');
    await rootNodeEl.click({ button: 'right' });
    await waitForContextMenu(page, 'context-menu-node-dir_root');

    const contextMenu = page.locator('[data-testid="context-menu-node-dir_root"]');

    // Should show the label.
    await expect(contextMenu.locator('.node-hover-title')).toContainText('/');

    // Should show a "Reveal in tree" button.
    await expect(
      contextMenu.locator('button[title="Reveal in tree"]'),
    ).toBeVisible();

    // Should NOT show the confusing @1.
    await expect(contextMenu).not.toContainText('@1');

    // Should show the directory path in the dedicated dir path element.
    await expect(contextMenu.locator('.node-hover-dir-path')).toContainText('/');
  });
});
