type MockGraphResponse = {
  nodes: Array<unknown>;
  edges: Array<unknown>;
  files: Array<[string, string]>;
};

export const normalizeQuery = (query: string): string => query.replace(/\s+/g, '');

const RESPONSES: Record<string, MockGraphResponse> = {};

export const BASE_QUERY = `"main" {
    "cli.Run" {}
};`;

RESPONSES[normalizeQuery(BASE_QUERY)] = {
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
          col_end: '10',
        },
      ],
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
          col_end: '10',
        },
      ],
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
          col_end: '10',
        },
      ],
    },
  ],
  edges: [
    {
      id: 'edge-1',
      from: 'node-1',
      to: 'node-2',
      from_file: 'file-1',
      from_line: '1',
    },
    {
      id: 'edge-2',
      from: 'node-2',
      to: 'node-3',
      from_file: 'file-2',
      from_line: '2',
    },
  ],
  files: [
    ['file-1', '/path/file1.askl'],
    ['file-2', '/path/file2.askl'],
    ['file-3', '/path/file3.askl'],
  ],
};

export const getMockResponseForQuery = (query: string): MockGraphResponse | undefined =>
  RESPONSES[normalizeQuery(query)];

export const SUBMIT_QUERY = BASE_QUERY;
