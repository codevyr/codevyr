import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  tapGraphNodeAndWaitForSource,
  waitForGraphNodeCount,
} from './test-utils';

const PROJECT_ID = '1';
const PROJECT = {
  id: PROJECT_ID,
  project_name: 'kubernetes',
  root_path: '/home/mplaneta/src/kubernetes',
};

const fileContents: Record<string, string> = {
  '1': 'package main\n\nfunc main() {}\n',
  '11': 'package logs\n\nfunc InitLogs() {}\n',
  readme: '# Kubernetes\n',
};

const fileIdToPath: Record<string, string> = {
  '1': '/home/mplaneta/src/kubernetes/cmd/kubelet/kubelet.go',
  '11': '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base/logs/logs.go',
  readme: '/home/mplaneta/src/kubernetes/README.md',
};

const treeNodes: Record<string, Array<{ name: string; path: string; node_type: 'dir' | 'file'; has_children: boolean; file_id?: string; filetype?: string; compact_path?: string }>> = {
  '/': [
    {
      name: 'home',
      path: '/home',
      node_type: 'dir',
      has_children: true,
      compact_path: '/home/mplaneta/src/kubernetes',
    },
  ],
  '/home/mplaneta/src/kubernetes': [
    {
      name: 'README.md',
      path: '/home/mplaneta/src/kubernetes/README.md',
      node_type: 'file',
      has_children: false,
      file_id: 'readme',
      filetype: 'text/markdown',
    },
    {
      name: 'cmd',
      path: '/home/mplaneta/src/kubernetes/cmd',
      node_type: 'dir',
      has_children: true,
    },
    {
      name: 'vendor',
      path: '/home/mplaneta/src/kubernetes/vendor',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/home/mplaneta/src/kubernetes/cmd': [
    {
      name: 'kubelet',
      path: '/home/mplaneta/src/kubernetes/cmd/kubelet',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/home/mplaneta/src/kubernetes/cmd/kubelet': [
    {
      name: 'kubelet.go',
      path: '/home/mplaneta/src/kubernetes/cmd/kubelet/kubelet.go',
      node_type: 'file',
      has_children: false,
      file_id: '1',
      filetype: 'text/x-go',
    },
  ],
  '/home/mplaneta/src/kubernetes/vendor': [
    {
      name: 'k8s.io',
      path: '/home/mplaneta/src/kubernetes/vendor/k8s.io',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/home/mplaneta/src/kubernetes/vendor/k8s.io': [
    {
      name: 'component-base',
      path: '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base': [
    {
      name: 'logs',
      path: '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base/logs',
      node_type: 'dir',
      has_children: true,
    },
  ],
  '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base/logs': [
    {
      name: 'logs.go',
      path: '/home/mplaneta/src/kubernetes/vendor/k8s.io/component-base/logs/logs.go',
      node_type: 'file',
      has_children: false,
      file_id: '11',
      filetype: 'text/x-go',
    },
  ],
};

const graphResponse = {
  nodes: [
    {
      id: '1',
      label: 'k8s.io/kubernetes/cmd/kubelet.main',
      symbol_instances: [
        {
          id: '1',
          symbol: '1',
          object_id: '1',
          symbol_type: 'Function',
          start_offset: 0,
          end_offset: 1,
        },
      ],
    },
    {
      id: '201',
      label: 'k8s.io/component-base/logs.InitLogs',
      symbol_instances: [
        {
          id: '201',
          symbol: '201',
          object_id: '11',
          symbol_type: 'Function',
          start_offset: 0,
          end_offset: 1,
        },
      ],
    },
  ],
  edges: [],
  objects: [
    { object_id: '1', path: fileIdToPath['1'], project_id: PROJECT_ID },
    { object_id: '11', path: fileIdToPath['11'], project_id: PROJECT_ID },
  ],
};

async function interceptIndexEndpoints(page: Page) {
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
        file_count: 3,
        symbol_count: 10,
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

async function interceptGraphEndpoint(page: Page) {
  await page.route('**/query**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graphResponse),
    });
  });
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const clipboard = {
      writeText: (text: string) => {
        (window as any).__clipboard = text;
        return Promise.resolve();
      },
      readText: () => Promise.resolve((window as any).__clipboard ?? ''),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: clipboard,
      configurable: true,
    });
  });
}

test('explorer opens compact directory and copies path', async ({ page }) => {
  await stubClipboard(page);
  await interceptIndexEndpoints(page);
  await loadApp(page);

  await page.locator('[data-testid="explorer-project"]').click();

  const compactNode = page.locator('[data-testid="explorer-node"][data-path="/home/mplaneta/src/kubernetes"]');
  await expect(compactNode).toBeVisible();
  await compactNode.click();

  const readmeNode = page.locator('[data-testid="explorer-node"][data-path="/home/mplaneta/src/kubernetes/README.md"]');
  await expect(readmeNode).toBeVisible();

  await readmeNode.click({ button: 'right' });
  await page.locator('[data-testid="explorer-copy-path"]').click();
  const clipboardValue = await page.evaluate(() => (window as any).__clipboard ?? '');
  expect(clipboardValue).toBe('/home/mplaneta/src/kubernetes/README.md');

  await readmeNode.click();
  await expect(page.locator('[data-testid="code-viewer"][data-file-id="readme"]')).toBeVisible();
  await expect(page.locator('.monaco-editor').last()).toContainText('Kubernetes');
});

test('graph click reveals explorer and opens editor', async ({ page }) => {
  await interceptIndexEndpoints(page);
  await interceptGraphEndpoint(page);
  await loadApp(page);
  await ensureEditorApis(page);

  await page.locator('.monaco-editor').click();
  await setEditorQuery(page, 'graph { foo -> bar }');
  await submitQuery(page);
  await waitForGraphNodeCount(page, 2);
  await ensureGraphApis(page);

  await tapGraphNodeAndWaitForSource(page, '1', '1');

  await expect(page.locator('[data-testid="code-viewer"][data-file-id="1"]')).toBeVisible();
  await expect(page.locator('.monaco-editor').last()).toContainText('func main()');

  const activeExplorerRow = page.locator('[data-testid="explorer-node"][data-node-path="/home/mplaneta/src/kubernetes/cmd/kubelet/kubelet.go"][data-active="true"]');
  await expect(activeExplorerRow).toBeVisible();
});
