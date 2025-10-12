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
      id: '4',
      label: 'k8s.io/component-base/cli.Run',
      declarations: [
        {
          id: '4',
          symbol: '4',
          file_id: '4',
          symbol_type: 'Declaration',
          line_start: '43',
          col_start: '1',
          line_end: '77',
          col_end: '2',
        },
      ],
    },
    {
      id: '22',
      label: 'k8s.io/component-base/cli.run',
      declarations: [
        {
          id: '22',
          symbol: '22',
          file_id: '4',
          symbol_type: 'Declaration',
          line_start: '86',
          col_start: '1',
          line_end: '145',
          col_end: '2',
        },
      ],
    },
    {
      id: '1',
      label: 'k8s.io/kubernetes/cmd/kubelet.main',
      declarations: [
        {
          id: '1',
          symbol: '1',
          file_id: '1',
          symbol_type: 'Declaration',
          line_start: '34',
          col_start: '1',
          line_end: '38',
          col_end: '2',
        },
      ],
    },
  ],
  edges: [
    {
      id: '1-4',
      from: '1',
      to: '4',
      from_file: '1',
      from_line: '36',
    },
    {
      id: '4-22',
      from: '4',
      to: '22',
      from_file: '4',
      from_line: '44',
    },
  ],
  files: [
    ['4', 'mock/run.go'],
    ['1', 'mock/kubelet.go'],
  ],
};

export const getMockResponseForQuery = (query: string): MockGraphResponse | undefined =>
  RESPONSES[normalizeQuery(query)];

export const SUBMIT_QUERY = BASE_QUERY;
