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
          start_offset: offsetFromLineCol('1', 34, 1),
          end_offset: offsetFromLineCol('1', 38, 2),
        },
      ],
    },
  ],
  edges: [
    {
      id: '1-4',
      from: '1',
      to: '4',
      from_object: '1',
      from_offset_start: offsetSpanForLine('1', 36).start,
      from_offset_end: offsetSpanForLine('1', 36).end,
    },
    {
      id: '4-22',
      from: '4',
      to: '22',
      from_object: '4',
      from_offset_start: offsetSpanForLine('4', 44).start,
      from_offset_end: offsetSpanForLine('4', 44).end,
    },
  ],
  objects: [
    { object_id: '4', path: 'mock/run.go', project_id: '1' },
    { object_id: '1', path: 'mock/kubelet.go', project_id: '1' },
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
          start_offset: offsetFromLineCol('1', 34, 1),
          end_offset: offsetFromLineCol('1', 38, 2),
        },
      ],
    },
  ],
  edges: [
    {
      id: '22-201',
      from: '22',
      to: '201',
      from_object: '4',
      from_offset_start: offsetSpanForLine('4', 132).start,
      from_offset_end: offsetSpanForLine('4', 132).end,
    },
    {
      id: '22-201',
      from: '22',
      to: '201',
      from_object: '4',
      from_offset_start: offsetSpanForLine('4', 138).start,
      from_offset_end: offsetSpanForLine('4', 138).end,
    },
    {
      id: '22-201',
      from: '22',
      to: '201',
      from_object: '4',
      from_offset_start: offsetSpanForLine('4', 125).start,
      from_offset_end: offsetSpanForLine('4', 125).end,
    },
    {
      id: '4-22',
      from: '4',
      to: '22',
      from_object: '4',
      from_offset_start: offsetSpanForLine('4', 44).start,
      from_offset_end: offsetSpanForLine('4', 44).end,
    },
    {
      id: '1-4',
      from: '1',
      to: '4',
      from_object: '1',
      from_offset_start: offsetSpanForLine('1', 36).start,
      from_offset_end: offsetSpanForLine('1', 36).end,
    },
  ],
  objects: [
    { object_id: '4', path: 'mock/run.go', project_id: '1' },
    { object_id: '11', path: 'mock/logs.go', project_id: '1' },
    { object_id: '1', path: 'mock/kubelet.go', project_id: '1' },
  ],
};

export const getMockResponseForQuery = (query: string): MockGraphResponse | undefined =>
  RESPONSES[normalizeQuery(query)];

export const SUBMIT_QUERY = BASE_QUERY;
export const SUBMIT_QUERY_INIT_LOGS = INIT_LOGS_QUERY;
