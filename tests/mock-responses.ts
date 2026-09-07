import { readFileSync } from 'fs';
import { resolve } from 'path';

type MockGraphResponse = {
  nodes: Array<unknown>;
  edges: Array<unknown>;
  objects: Array<{ object_id: string; path: string; project_id?: string }>;
};

const mockDir = resolve(__dirname, 'mock');

const mockFileContents: Record<string, string> = {
  '1': readFileSync(resolve(mockDir, 'kubelet.go'), 'utf-8'),
  '4': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
  '11': readFileSync(resolve(mockDir, 'logs.go'), 'utf-8'),
  '22': readFileSync(resolve(mockDir, 'run.go'), 'utf-8'),
};

function offsetFromLineCol(fileId: string, lineNumber: number, columnNumber: number): number {
  const content = mockFileContents[fileId];
  if (!content) {
    return 0;
  }

  const lines = content.split('\n');
  const lineIndex = Math.min(Math.max(lineNumber - 1, 0), Math.max(lines.length - 1, 0));
  let offset = 0;

  for (let i = 0; i < lineIndex; i += 1) {
    offset += Buffer.byteLength(lines[i], 'utf-8') + 1;
  }

  const line = lines[lineIndex] ?? '';
  const columnIndex = Math.min(Math.max(columnNumber - 1, 0), line.length);
  offset += Buffer.byteLength(line.slice(0, columnIndex), 'utf-8');
  return offset;
}

function offsetSpanForLine(fileId: string, lineNumber: number): { start: number; end: number } {
  const content = mockFileContents[fileId];
  if (!content) {
    return { start: 0, end: 0 };
  }

  const lines = content.split('\n');
  const lineIndex = Math.min(Math.max(lineNumber - 1, 0), Math.max(lines.length - 1, 0));
  const line = lines[lineIndex] ?? '';
  const endColumn = Math.min(2, line.length + 1);

  return {
    start: offsetFromLineCol(fileId, lineNumber, 1),
    end: offsetFromLineCol(fileId, lineNumber, endColumn),
  };
}

export const normalizeQuery = (query: string): string => query.replace(/\s+/g, '');

const RESPONSES: Record<string, MockGraphResponse> = {};

export const BASE_QUERY = `"main" {
    "cli.Run" {}
};`;

export const INIT_LOGS_QUERY = `"main" {
    "cli.Run" {{"InitLogs"}}
};`;

RESPONSES[normalizeQuery(BASE_QUERY)] = {
  nodes: [
    {
      id: '4',
      label: 'k8s.io/component-base/cli.Run',
      symbol_instances: [
        {
          id: '4',
          symbol: '4',
          object_id: '4',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('4', 43, 1),
          end_offset: offsetFromLineCol('4', 77, 2),
        },
      ],
    },
    {
      id: '22',
      label: 'k8s.io/component-base/cli.run',
      symbol_instances: [
        {
          id: '22',
          symbol: '22',
          object_id: '4',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('4', 86, 1),
          end_offset: offsetFromLineCol('4', 145, 2),
        },
      ],
    },
    {
      id: '1',
      label: 'k8s.io/kubernetes/cmd/kubelet.main',
      symbol_instances: [
        {
          id: '1',
          symbol: '1',
          object_id: '1',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('1', 34, 1),
          end_offset: offsetFromLineCol('1', 38, 2),
        },
      ],
    },
  ],
  edges: [
    { from: '1', to: '4', occurrence_count: 1, from_objects: ['1'] },
    { from: '4', to: '22', occurrence_count: 1, from_objects: ['4'] },
  ],
  objects: [
    { object_id: '4', path: '/mock/run.go', project_id: '1' },
    { object_id: '1', path: '/mock/kubelet.go', project_id: '1' },
  ],
};

RESPONSES[normalizeQuery(INIT_LOGS_QUERY)] = {
  nodes: [
    {
      id: '22',
      label: 'k8s.io/component-base/cli.run',
      symbol_instances: [
        {
          id: '22',
          symbol: '22',
          object_id: '4',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('4', 86, 1),
          end_offset: offsetFromLineCol('4', 145, 2),
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
          instance_type: 'definition',
          start_offset: offsetFromLineCol('11', 161, 1),
          end_offset: offsetFromLineCol('11', 173, 2),
        },
      ],
    },
    {
      id: '4',
      label: 'k8s.io/component-base/cli.Run',
      symbol_instances: [
        {
          id: '4',
          symbol: '4',
          object_id: '4',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('4', 43, 1),
          end_offset: offsetFromLineCol('4', 77, 2),
        },
      ],
    },
    {
      id: '1',
      label: 'k8s.io/kubernetes/cmd/kubelet.main',
      symbol_instances: [
        {
          id: '1',
          symbol: '1',
          object_id: '1',
          symbol_type: 'Function',
          instance_type: 'definition',
          start_offset: offsetFromLineCol('1', 34, 1),
          end_offset: offsetFromLineCol('1', 38, 2),
        },
      ],
    },
  ],
  edges: [
    { from: '22', to: '201', occurrence_count: 3, from_objects: ['4'] },
    { from: '4', to: '22', occurrence_count: 1, from_objects: ['4'] },
    { from: '1', to: '4', occurrence_count: 1, from_objects: ['1'] },
  ],
  objects: [
    { object_id: '4', path: '/mock/run.go', project_id: '1' },
    { object_id: '11', path: '/mock/logs.go', project_id: '1' },
    { object_id: '1', path: '/mock/kubelet.go', project_id: '1' },
  ],
};

export const getMockResponseForQuery = (query: string): MockGraphResponse | undefined =>
  RESPONSES[normalizeQuery(query)];

/**
 * Call sites per edge, served by the mocked
 * `/v1/edge/{from}/{to}/occurrences`. `/query` ships only pairs + counts, so
 * anything that opens an edge (or clicks a single-call-site one) reads these.
 */
const occurrence = (fileId: string, line: number, refId: string) => ({
  ref_id: refId,
  from_instance_id: `inst-${refId}`,
  object_id: fileId,
  path: fileId === '1' ? '/mock/kubelet.go' : '/mock/run.go',
  project_id: '1',
  start_offset: offsetSpanForLine(fileId, line).start,
  end_offset: offsetSpanForLine(fileId, line).end,
});

const EDGE_OCCURRENCES: Record<string, ReturnType<typeof occurrence>[]> = {
  '1-4': [occurrence('1', 36, 'r1')],
  '4-22': [occurrence('4', 44, 'r2')],
  '22-201': [
    occurrence('4', 125, 'r3'),
    occurrence('4', 132, 'r4'),
    occurrence('4', 138, 'r5'),
  ],
};

export const getMockEdgeOccurrences = (from: string, to: string) => ({
  rows: EDGE_OCCURRENCES[`${from}-${to}`] ?? [],
  next: null,
});

export const SUBMIT_QUERY = BASE_QUERY;
export const SUBMIT_QUERY_INIT_LOGS = INIT_LOGS_QUERY;
