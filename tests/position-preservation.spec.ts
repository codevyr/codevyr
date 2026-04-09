import { test, expect, Page } from '@playwright/test';
import {
  ensureEditorApis,
  ensureGraphApis,
  loadApp,
  setEditorQuery,
  submitQuery,
  waitForGraphNodeCount,
} from './test-utils';

// First query: hierarchy A contains B and C, plus standalone D.
// Edges: B→D, C→D.
const firstResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 80 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B' },
    { id: 'has-A-C', parent: 'A', child: 'C', parent_instance: 'si_A', child_instance: 'si_C' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// Second query: same hierarchy (A contains B, C) plus D and new node E.
// Same structure, just an extra node — B, C, D positions should be preserved.
const secondResponseSameHierarchy = {
  nodes: [
    ...firstResponse.nodes,
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 10, end_offset: 20 },
      ],
    },
  ],
  edges: [
    ...firstResponse.edges,
    { id: 'D-E', from: 'D', to: 'E', from_object: 'obj_D', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: firstResponse.has_edges,
  objects: firstResponse.objects,
  warnings: [],
};

// Third response: flat — hierarchy removed, B and C become standalone, A removed.
const thirdResponseFlat = {
  nodes: [
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 80 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
  ],
  has_edges: [],
  objects: firstResponse.objects,
  warnings: [],
};

// Two-group hierarchy: A contains B,C and E contains F, plus standalone D.
const twoGroupResponse = {
  nodes: [
    ...firstResponse.nodes,
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'F',
      label: 'F',
      symbol_instances: [
        { id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 },
      ],
    },
  ],
  edges: [
    ...firstResponse.edges,
    { id: 'F-D', from: 'F', to: 'D', from_object: 'obj_E', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B' },
    { id: 'has-A-C', parent: 'A', child: 'C', parent_instance: 'si_A', child_instance: 'si_C' },
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
  ],
  objects: [
    ...firstResponse.objects,
    { object_id: 'obj_E', path: 'mock/e.go' },
  ],
  warnings: [],
};

// One group removed: A gone, B and C liberated. E still contains F.
const oneGroupRemovedResponse = {
  nodes: [
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 80 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'F',
      label: 'F',
      symbol_instances: [
        { id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
    { id: 'F-D', from: 'F', to: 'D', from_object: 'obj_E', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
  ],
  objects: [
    ...firstResponse.objects,
    { object_id: 'obj_E', path: 'mock/e.go' },
  ],
  warnings: [],
};

// Multi-level nesting: A contains B, B contains C. Plus standalone D and group E→F.
const multiLevelResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 200 },
      ],
    },
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'F',
      label: 'F',
      symbol_instances: [
        { id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 },
      ],
    },
  ],
  edges: [
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'F-D', from: 'F', to: 'D', from_object: 'obj_E', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B' },
    { id: 'has-B-C', parent: 'B', child: 'C', parent_instance: 'si_B', child_instance: 'si_C' },
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
    { object_id: 'obj_E', path: 'mock/e.go' },
  ],
  warnings: [],
};

// Multi-level unnested: A and B removed, C standalone. E still contains F.
const multiLevelUnnestedResponse = {
  nodes: [
    {
      id: 'C',
      label: 'C',
      symbol_instances: [
        { id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
    {
      id: 'E',
      label: 'E',
      symbol_instances: [
        { id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 },
      ],
    },
    {
      id: 'F',
      label: 'F',
      symbol_instances: [
        { id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 },
      ],
    },
  ],
  edges: [
    { id: 'C-D', from: 'C', to: 'D', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'F-D', from: 'F', to: 'D', from_object: 'obj_E', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
    { object_id: 'obj_E', path: 'mock/e.go' },
  ],
  warnings: [],
};

// Complex graph: Group A contains B,C,D. Group E contains F,G.
// Standalone H, I. Cross-hierarchy edges: B→H, C→I, D→F, G→H.
const complexHierarchyResponse = {
  nodes: [
    { id: 'A', label: 'A', symbol_instances: [{ id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 200 }] },
    { id: 'B', label: 'B', symbol_instances: [{ id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 }] },
    { id: 'C', label: 'C', symbol_instances: [{ id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 100 }] },
    { id: 'D', label: 'D', symbol_instances: [{ id: 'si_D', symbol: 'D', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 100, end_offset: 150 }] },
    { id: 'E', label: 'E', symbol_instances: [{ id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 }] },
    { id: 'F', label: 'F', symbol_instances: [{ id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 }] },
    { id: 'G', label: 'G', symbol_instances: [{ id: 'si_G', symbol: 'G', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 30, end_offset: 60 }] },
    { id: 'H', label: 'H', symbol_instances: [{ id: 'si_H', symbol: 'H', object_id: 'obj_H', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 20 }] },
    { id: 'I', label: 'I', symbol_instances: [{ id: 'si_I', symbol: 'I', object_id: 'obj_I', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 20 }] },
  ],
  edges: [
    { id: 'B-H', from: 'B', to: 'H', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-I', from: 'C', to: 'I', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
    { id: 'D-F', from: 'D', to: 'F', from_object: 'obj_A', from_offset_start: 100, from_offset_end: 101 },
    { id: 'G-H', from: 'G', to: 'H', from_object: 'obj_E', from_offset_start: 30, from_offset_end: 31 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B' },
    { id: 'has-A-C', parent: 'A', child: 'C', parent_instance: 'si_A', child_instance: 'si_C' },
    { id: 'has-A-D', parent: 'A', child: 'D', parent_instance: 'si_A', child_instance: 'si_D' },
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
    { id: 'has-E-G', parent: 'E', child: 'G', parent_instance: 'si_E', child_instance: 'si_G' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_E', path: 'mock/e.go' },
    { object_id: 'obj_H', path: 'mock/h.go' },
    { object_id: 'obj_I', path: 'mock/i.go' },
  ],
  warnings: [],
};

// A removed, B,C,D liberated. E still contains F,G. H,I standalone. Same edges.
const complexLiberatedResponse = {
  nodes: [
    { id: 'B', label: 'B', symbol_instances: [{ id: 'si_B', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 }] },
    { id: 'C', label: 'C', symbol_instances: [{ id: 'si_C', symbol: 'C', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 100 }] },
    { id: 'D', label: 'D', symbol_instances: [{ id: 'si_D', symbol: 'D', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 100, end_offset: 150 }] },
    { id: 'E', label: 'E', symbol_instances: [{ id: 'si_E', symbol: 'E', object_id: 'obj_E', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 100 }] },
    { id: 'F', label: 'F', symbol_instances: [{ id: 'si_F', symbol: 'F', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 30 }] },
    { id: 'G', label: 'G', symbol_instances: [{ id: 'si_G', symbol: 'G', object_id: 'obj_E', symbol_type: 'Function', instance_type: 'definition', start_offset: 30, end_offset: 60 }] },
    { id: 'H', label: 'H', symbol_instances: [{ id: 'si_H', symbol: 'H', object_id: 'obj_H', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 20 }] },
    { id: 'I', label: 'I', symbol_instances: [{ id: 'si_I', symbol: 'I', object_id: 'obj_I', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 20 }] },
  ],
  edges: [
    { id: 'B-H', from: 'B', to: 'H', from_object: 'obj_A', from_offset_start: 0, from_offset_end: 1 },
    { id: 'C-I', from: 'C', to: 'I', from_object: 'obj_A', from_offset_start: 50, from_offset_end: 51 },
    { id: 'D-F', from: 'D', to: 'F', from_object: 'obj_A', from_offset_start: 100, from_offset_end: 101 },
    { id: 'G-H', from: 'G', to: 'H', from_object: 'obj_E', from_offset_start: 30, from_offset_end: 31 },
  ],
  has_edges: [
    { id: 'has-E-F', parent: 'E', child: 'F', parent_instance: 'si_E', child_instance: 'si_F' },
    { id: 'has-E-G', parent: 'E', child: 'G', parent_instance: 'si_E', child_instance: 'si_G' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_E', path: 'mock/e.go' },
    { object_id: 'obj_H', path: 'mock/h.go' },
    { object_id: 'obj_I', path: 'mock/i.go' },
  ],
  warnings: [],
};

// Split scenario: B has instances both inside group A and standalone.
// splitMultiParentNodes will split B into B\0contained-by:A and B\0root.
const splitHierarchyResponse = {
  nodes: [
    {
      id: 'A',
      label: 'A',
      symbol_instances: [
        { id: 'si_A', symbol: 'A', object_id: 'obj_A', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 200 },
      ],
    },
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B1', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
        { id: 'si_B2', symbol: 'B', object_id: 'obj_other', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_other', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B1' },
  ],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_other', path: 'mock/other.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// Group A removed — B is no longer split, just B with both instances. D stays.
const unsplitFlatResponse = {
  nodes: [
    {
      id: 'B',
      label: 'B',
      symbol_instances: [
        { id: 'si_B1', symbol: 'B', object_id: 'obj_A', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
        { id: 'si_B2', symbol: 'B', object_id: 'obj_other', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
      ],
    },
    {
      id: 'D',
      label: 'D',
      symbol_instances: [
        { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
      ],
    },
  ],
  edges: [
    { id: 'B-D', from: 'B', to: 'D', from_object: 'obj_other', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [],
  objects: [
    { object_id: 'obj_A', path: 'mock/a.go' },
    { object_id: 'obj_other', path: 'mock/other.go' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// Directory gains a new child (simulates removing an ignore line).
// host→{pci_file} and pci_file→{func_B}, plus standalone D.
// Then pci_file gains a new child func_X.
const dirWithTwoChildren = {
  nodes: [
    { id: 'host', label: 'host', symbol_instances: [
      { id: 'si_host', symbol: 'host', object_id: 'obj_host', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 500 },
    ]},
    { id: 'pci_file', label: 'pci.c', symbol_instances: [
      { id: 'si_pci', symbol: 'pci_file', object_id: 'obj_pci', symbol_type: 'Directory', instance_type: 'containment', start_offset: 0, end_offset: 200 },
    ]},
    { id: 'func_B', label: 'func_B', symbol_instances: [
      { id: 'si_fB', symbol: 'func_B', object_id: 'obj_pci', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 50 },
    ]},
    { id: 'func_C', label: 'func_C', symbol_instances: [
      { id: 'si_fC', symbol: 'func_C', object_id: 'obj_pci', symbol_type: 'Function', instance_type: 'definition', start_offset: 50, end_offset: 100 },
    ]},
    { id: 'D', label: 'D', symbol_instances: [
      { id: 'si_D', symbol: 'D', object_id: 'obj_D', symbol_type: 'Function', instance_type: 'definition', start_offset: 0, end_offset: 10 },
    ]},
  ],
  edges: [
    { id: 'fB-D', from: 'func_B', to: 'D', from_object: 'obj_pci', from_offset_start: 0, from_offset_end: 1 },
  ],
  has_edges: [
    { id: 'has-host-pci', parent: 'host', child: 'pci_file', parent_instance: 'si_host', child_instance: 'si_pci' },
    { id: 'has-pci-fB', parent: 'pci_file', child: 'func_B', parent_instance: 'si_pci', child_instance: 'si_fB' },
    { id: 'has-pci-fC', parent: 'pci_file', child: 'func_C', parent_instance: 'si_pci', child_instance: 'si_fC' },
  ],
  objects: [
    { object_id: 'obj_host', path: 'mock/host' },
    { object_id: 'obj_pci', path: 'mock/host/pci.c' },
    { object_id: 'obj_D', path: 'mock/d.go' },
  ],
  warnings: [],
};

// pci_file gains a new child func_X (simulates removing ignore that suppressed func_X).
const dirWithNewChild = {
  nodes: [
    ...dirWithTwoChildren.nodes,
    { id: 'func_X', label: 'func_X', symbol_instances: [
      { id: 'si_fX', symbol: 'func_X', object_id: 'obj_pci', symbol_type: 'Function', instance_type: 'definition', start_offset: 100, end_offset: 150 },
    ]},
  ],
  edges: [
    ...dirWithTwoChildren.edges,
    { id: 'fX-D', from: 'func_X', to: 'D', from_object: 'obj_pci', from_offset_start: 100, from_offset_end: 101 },
  ],
  has_edges: [
    ...dirWithTwoChildren.has_edges,
    { id: 'has-pci-fX', parent: 'pci_file', child: 'func_X', parent_instance: 'si_pci', child_instance: 'si_fX' },
  ],
  objects: dirWithTwoChildren.objects,
  warnings: [],
};

// Fourth response: hierarchy changes — C moves from child of A to child of D.
const thirdResponseChangedHierarchy = {
  nodes: firstResponse.nodes,
  edges: firstResponse.edges,
  has_edges: [
    { id: 'has-A-B', parent: 'A', child: 'B', parent_instance: 'si_A', child_instance: 'si_B' },
    { id: 'has-D-C', parent: 'D', child: 'C', parent_instance: 'si_D', child_instance: 'si_C' },
  ],
  objects: firstResponse.objects,
  warnings: [],
};

type NodePositions = Record<string, { x: number; y: number }>;

async function getNodePositions(page: Page, nodeIds: string[]): Promise<NodePositions> {
  return page.evaluate((ids) => {
    const positions: Record<string, { x: number; y: number }> = {};
    const missing: string[] = [];
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="graph-node-${id}"]`);
      if (!el) { missing.push(id); continue; }
      const wrapper = el.closest('.react-flow__node') as HTMLElement | null;
      if (!wrapper) { missing.push(id); continue; }
      const transform = wrapper.style.transform;
      const match = transform.match(/translate(?:3d)?\(([^,]+),\s*([^,)]+)/);
      if (!match) {
        throw new Error(`Could not parse transform for node ${id}: "${transform}"`);
      }
      positions[id] = {
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
      };
    }
    if (missing.length > 0) {
      throw new Error(`Nodes not found in DOM: ${missing.join(', ')}`);
    }
    return positions;
  }, nodeIds);
}

async function getAllNodePositions(page: Page): Promise<NodePositions> {
  return page.evaluate(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    document.querySelectorAll('.react-flow__node').forEach((wrapper) => {
      const el = wrapper.querySelector('[data-testid]') as HTMLElement | null;
      if (!el) return;
      const testId = el.getAttribute('data-testid') ?? '';
      if (!testId.startsWith('graph-node-')) return;
      const nodeId = testId.slice('graph-node-'.length);
      const transform = (wrapper as HTMLElement).style.transform;
      const match = transform.match(/translate(?:3d)?\(([^,]+),\s*([^,)]+)/);
      if (match) {
        positions[nodeId] = {
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
        };
      }
    });
    return positions;
  });
}

async function waitForLayoutGen(page: Page, minGen: number) {
  await page.waitForFunction((gen) => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    const current = el?.getAttribute('data-layout-gen');
    return current !== null && Number(current) >= gen;
  }, minGen);
}

async function getLayoutGen(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="graph-metadata"]');
    return Number(el?.getAttribute('data-layout-gen') ?? '0');
  });
}

async function setupSequentialMocks(page: Page, responses: object[]) {
  let queryCount = 0;
  await page.route('**/query**', async (route) => {
    if (queryCount >= responses.length) {
      throw new Error(
        `Unexpected API call #${queryCount + 1}; only ${responses.length} responses configured`,
      );
    }
    const response = responses[queryCount];
    queryCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/source/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'package main\n',
    });
  });

  await loadApp(page);
  await ensureEditorApis(page);
  await page.locator('.monaco-editor').click();
}

async function dragNode(page: Page, nodeId: string, dx: number, dy: number) {
  const el = page.locator(`[data-testid="graph-node-${nodeId}"]`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`node ${nodeId} not visible`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      startX + (dx * i) / steps,
      startY + (dy * i) / steps,
    );
  }
  await page.mouse.up();
}

test.describe('node position preservation across re-execution', () => {
  test('preserves existing positions when new nodes are added with hierarchy', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, secondResponseSameHierarchy]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['A', 'B', 'C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(4);

    // Second query — same hierarchy, adds node E
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 5);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D', 'E']);

    // Preserved nodes should stay close to their original positions
    for (const id of ['B', 'C', 'D']) {
      const dx = Math.abs(positionsAfter[id]!.x - positionsBefore[id]!.x);
      const dy = Math.abs(positionsAfter[id]!.y - positionsBefore[id]!.y);
      expect(dx, `node ${id} x should not move`).toBeLessThan(0.1);
      expect(dy, `node ${id} y should not move`).toBeLessThan(0.1);
    }

    // New node E should exist
    expect(positionsAfter['E']).toBeDefined();
  });

  test('identical re-execution preserves all positions', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, firstResponse]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['A', 'B', 'C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(4);

    // Re-run identical query
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D']);

    // Every node should be pixel-identical
    for (const id of ['A', 'B', 'C', 'D']) {
      const dx = Math.abs(positionsAfter[id]!.x - positionsBefore[id]!.x);
      const dy = Math.abs(positionsAfter[id]!.y - positionsBefore[id]!.y);
      expect(dx, `node ${id} x should not move`).toBeLessThan(0.1);
      expect(dy, `node ${id} y should not move`).toBeLessThan(0.1);
    }
  });

  test('does full relayout when hierarchy changes', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, thirdResponseChangedHierarchy]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    // Second query — C moves from child of A to child of D
    // Hierarchy changed, so full relayout occurs (no partial preservation)
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['A', 'B', 'C', 'D']);

    // All nodes should have positions (layout completed successfully)
    expect(Object.keys(positionsAfter)).toHaveLength(4);

    // C is now child of D — verify C's position is below D (direction is DOWN)
    expect(positionsAfter['C']!.y, 'child C should be below parent D').toBeGreaterThan(positionsAfter['D']!.y);
  });

  test('child→standalone transition does not jump to origin', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, thirdResponseFlat]);

    // First query: hierarchy — A contains B and C, D standalone
    await setEditorQuery(page, '"hierarchy" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['B', 'C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(3);

    // B and C should be well away from origin (inside group A)
    expect(Math.abs(positionsBefore['B']!.x) + Math.abs(positionsBefore['B']!.y)).toBeGreaterThan(50);

    // Second query: flat — B and C become standalone, A removed
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"flat" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 3);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['B', 'C', 'D']);

    // B should stay exactly at its previous absolute position (ELK preserves
    // fixed positions). Without the fix, B jumps to ~(15, 35) from ~(200+, 100+).
    const deltaX = Math.abs(positionsAfter['B']!.x - positionsBefore['B']!.x);
    const deltaY = Math.abs(positionsAfter['B']!.y - positionsBefore['B']!.y);
    expect(deltaX, 'node B x should not move').toBeLessThan(0.1);
    expect(deltaY, 'node B y should not move').toBeLessThan(0.1);

    // D (always standalone) should also stay put
    const dDeltaX = Math.abs(positionsAfter['D']!.x - positionsBefore['D']!.x);
    const dDeltaY = Math.abs(positionsAfter['D']!.y - positionsBefore['D']!.y);
    expect(dDeltaX, 'node D x should not move').toBeLessThan(0.1);
    expect(dDeltaY, 'node D y should not move').toBeLessThan(0.1);
  });

  test('liberated nodes stay put when other groups remain (hierarchy→hierarchy)', async ({ page }) => {
    await setupSequentialMocks(page, [twoGroupResponse, oneGroupRemovedResponse]);

    // First query: two groups — A contains B,C and E contains F, plus D standalone
    await setEditorQuery(page, '"two-groups" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 6);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['B', 'C', 'D', 'F']);
    expect(Object.keys(positionsBefore)).toHaveLength(4);

    // Second query: A removed, B and C liberated. E still contains F.
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"one-group" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 5);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['B', 'C', 'D', 'F']);

    // Liberated nodes B and C should stay near their original absolute positions.
    // Without the fix, ELK runs a fresh hierarchy layout and moves them.
    for (const id of ['B', 'C']) {
      const dx = Math.abs(positionsAfter[id]!.x - positionsBefore[id]!.x);
      const dy = Math.abs(positionsAfter[id]!.y - positionsBefore[id]!.y);
      expect(dx, `node ${id} x should not jump`).toBeLessThan(0.1);
      expect(dy, `node ${id} y should not jump`).toBeLessThan(0.1);
    }

    // D (always standalone) should also stay close
    const dDeltaX = Math.abs(positionsAfter['D']!.x - positionsBefore['D']!.x);
    const dDeltaY = Math.abs(positionsAfter['D']!.y - positionsBefore['D']!.y);
    expect(dDeltaX, 'node D x should not jump').toBeLessThan(0.1);
    expect(dDeltaY, 'node D y should not jump').toBeLessThan(0.1);
  });

  test('multi-level nesting: deeply nested node stays put when all ancestors removed', async ({ page }) => {
    await setupSequentialMocks(page, [multiLevelResponse, multiLevelUnnestedResponse]);

    // First query: A→B→C (3 levels), E→F, standalone D
    await setEditorQuery(page, '"multi-level" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 6);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['C', 'D', 'F']);
    expect(Object.keys(positionsBefore)).toHaveLength(3);

    // Second query: A and B removed, C standalone. E still contains F.
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"unnested" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['C', 'D', 'F']);

    // C was deeply nested (A→B→C) and should stay at its absolute position
    const cDeltaX = Math.abs(positionsAfter['C']!.x - positionsBefore['C']!.x);
    const cDeltaY = Math.abs(positionsAfter['C']!.y - positionsBefore['C']!.y);
    expect(cDeltaX, 'node C x should not jump').toBeLessThan(0.1);
    expect(cDeltaY, 'node C y should not jump').toBeLessThan(0.1);

    // D (always standalone) should also stay put
    const dDeltaX = Math.abs(positionsAfter['D']!.x - positionsBefore['D']!.x);
    const dDeltaY = Math.abs(positionsAfter['D']!.y - positionsBefore['D']!.y);
    expect(dDeltaX, 'node D x should not jump').toBeLessThan(0.1);
    expect(dDeltaY, 'node D y should not jump').toBeLessThan(0.1);

    // F (still inside E) should stay at same absolute position
    const fDeltaX = Math.abs(positionsAfter['F']!.x - positionsBefore['F']!.x);
    const fDeltaY = Math.abs(positionsAfter['F']!.y - positionsBefore['F']!.y);
    expect(fDeltaX, 'node F x should not jump').toBeLessThan(0.1);
    expect(fDeltaY, 'node F y should not jump').toBeLessThan(0.1);
  });

  test('complex cross-hierarchy edges: liberated nodes with edges to standalone nodes stay put', async ({ page }) => {
    await setupSequentialMocks(page, [complexHierarchyResponse, complexLiberatedResponse]);

    // First query: A→{B,C,D}, E→{F,G}, standalone H,I
    // Edges: B→H, C→I, D→F (cross-group), G→H
    await setEditorQuery(page, '"complex" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 9);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const allIds = ['B', 'C', 'D', 'F', 'G', 'H', 'I'];
    const positionsBefore = await getNodePositions(page, allIds);
    expect(Object.keys(positionsBefore)).toHaveLength(allIds.length);

    // Second query: A removed, B,C,D liberated. E→{F,G} stays. H,I stay.
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"liberated" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 8);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, allIds);

    // Every surviving node should stay at its absolute position
    for (const id of allIds) {
      const dx = Math.abs(positionsAfter[id]!.x - positionsBefore[id]!.x);
      const dy = Math.abs(positionsAfter[id]!.y - positionsBefore[id]!.y);
      expect(dx, `node ${id} x should not jump`).toBeLessThan(0.1);
      expect(dy, `node ${id} y should not jump`).toBeLessThan(0.1);
    }
  });

  test('split→unsplit: node with instances in multiple contexts preserves position', async ({ page }) => {
    await setupSequentialMocks(page, [splitHierarchyResponse, unsplitFlatResponse]);

    // First query: B is split into B\0contained-by:A (inside A) and B\0root (standalone)
    // Total: A, B\0contained-by:A, B\0root, D = 4 nodes
    await setEditorQuery(page, '"split" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    // Get all positions — split node IDs contain NUL characters
    const allBefore = await getAllNodePositions(page);
    const dBefore = allBefore['D'];
    expect(dBefore, 'D should exist before').toBeDefined();

    // Find the standalone B split (B\0root) — the one NOT inside group A
    const bRootKey = Object.keys(allBefore).find(k => k.startsWith('B') && k.includes('root'));
    expect(bRootKey, 'B root split should exist').toBeDefined();
    const bRootBefore = allBefore[bRootKey!];

    // Second query: B is unsplit, group A removed. 2 nodes: B, D.
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"unsplit" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 2);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['B', 'D']);

    // D should stay put
    const dDx = Math.abs(positionsAfter['D']!.x - dBefore.x);
    const dDy = Math.abs(positionsAfter['D']!.y - dBefore.y);
    expect(dDx, 'node D x should not jump').toBeLessThan(0.1);
    expect(dDy, 'node D y should not jump').toBeLessThan(0.1);

    // B (unsplit) should be near where B\0root was — NOT at the origin.
    // Without the fix, B has no positionsRef entry and defaults to {0, 0}.
    const bDx = Math.abs(positionsAfter['B']!.x - bRootBefore.x);
    const bDy = Math.abs(positionsAfter['B']!.y - bRootBefore.y);
    expect(bDx, 'unsplit B x should be near old B root').toBeLessThan(0.1);
    expect(bDy, 'unsplit B y should be near old B root').toBeLessThan(0.1);
  });

  test('unsplit→split: flat node splits into multiple contexts preserves position', async ({ page }) => {
    // Reverse of the split→unsplit test: start flat, then introduce hierarchy that splits B.
    await setupSequentialMocks(page, [unsplitFlatResponse, splitHierarchyResponse]);

    // First query: flat — B (unsplit) and D
    await setEditorQuery(page, '"flat" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 2);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['B', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(2);

    // Second query: B splits into B\0contained-by:A (inside A) and B\0root (standalone)
    // D stays. Total: A, B\0contained-by:A, B\0root, D = 4 nodes
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"split" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const allAfter = await getAllNodePositions(page);

    // D should stay put
    const dDx = Math.abs(allAfter['D']!.x - positionsBefore['D']!.x);
    const dDy = Math.abs(allAfter['D']!.y - positionsBefore['D']!.y);
    expect(dDx, 'node D x should not jump').toBeLessThan(0.1);
    expect(dDy, 'node D y should not jump').toBeLessThan(0.1);

    // B\0root (standalone split) should be near where B was.
    const bRootKey = Object.keys(allAfter).find(k => k.startsWith('B') && k.includes('root'));
    expect(bRootKey, 'B root split should exist').toBeDefined();
    const bRootAfter = allAfter[bRootKey!];
    const bDx = Math.abs(bRootAfter.x - positionsBefore['B']!.x);
    const bDy = Math.abs(bRootAfter.y - positionsBefore['B']!.y);
    expect(bDx, 'split B root x should be near old B').toBeLessThan(0.1);
    expect(bDy, 'split B root y should be near old B').toBeLessThan(0.1);
  });

  test('directory gains new child: existing children stay put', async ({ page }) => {
    await setupSequentialMocks(page, [dirWithTwoChildren, dirWithNewChild]);

    // First query: host→pci_file→{func_B, func_C}, standalone D
    await setEditorQuery(page, '"before-ignore-removed" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 5);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['func_B', 'func_C', 'D']);
    expect(Object.keys(positionsBefore)).toHaveLength(3);

    // Second query: same + func_X added as new child of pci_file.
    // pci_file's children changed → pci_file is non-preservable.
    // Without the fix, pci_file gets a fresh position from ELK + median delta,
    // dragging func_B and func_C to wrong absolute positions.
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"after-ignore-removed" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 6);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfter = await getNodePositions(page, ['func_B', 'func_C', 'D']);

    // Existing children of pci_file should stay at their absolute positions
    for (const id of ['func_B', 'func_C', 'D']) {
      const dx = Math.abs(positionsAfter[id]!.x - positionsBefore[id]!.x);
      const dy = Math.abs(positionsAfter[id]!.y - positionsBefore[id]!.y);
      expect(dx, `node ${id} x should not jump`).toBeLessThan(0.1);
      expect(dy, `node ${id} y should not jump`).toBeLessThan(0.1);
    }
  });

  test('user-dragged position is preserved across identical re-execution', async ({ page }) => {
    await setupSequentialMocks(page, [firstResponse, firstResponse]);

    // First query
    await setEditorQuery(page, '"first" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await ensureGraphApis(page);
    await waitForLayoutGen(page, 1);

    const positionsBefore = await getNodePositions(page, ['D']);

    // Drag node D using the React Flow wrapper element directly.
    // We target the wrapper (.react-flow__node) because React Flow attaches
    // drag handlers there, not on the inner data-testid element.
    const wrapper = page.locator('[data-testid="graph-node-D"]').locator('..');
    await wrapper.hover();
    const box = await wrapper.boundingBox();
    expect(box, 'D wrapper should be visible').toBeTruthy();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(startX + (120 * i) / 10, startY + (80 * i) / 10);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    const positionsAfterDrag = await getNodePositions(page, ['D']);
    // Verify drag actually moved the node in React Flow coordinate space
    const dragDx = Math.abs(positionsAfterDrag['D']!.x - positionsBefore['D']!.x);
    const dragDy = Math.abs(positionsAfterDrag['D']!.y - positionsBefore['D']!.y);
    expect(dragDx, 'drag should have moved D horizontally').toBeGreaterThan(30);
    expect(dragDy, 'drag should have moved D vertically').toBeGreaterThan(20);

    // Re-focus the editor (drag moved focus to the graph canvas)
    await page.locator('.monaco-editor').click();

    // Re-execute identical query
    const genBefore = await getLayoutGen(page);
    await setEditorQuery(page, '"second" {};');
    await submitQuery(page);
    await waitForGraphNodeCount(page, 4);
    await waitForLayoutGen(page, genBefore + 1);

    const positionsAfterReexec = await getNodePositions(page, ['D']);

    // Dragged position should be preserved across re-execution
    const reexecDx = Math.abs(positionsAfterReexec['D']!.x - positionsAfterDrag['D']!.x);
    const reexecDy = Math.abs(positionsAfterReexec['D']!.y - positionsAfterDrag['D']!.y);
    expect(reexecDx, 'D x should stay at dragged position').toBeLessThan(0.1);
    expect(reexecDy, 'D y should stay at dragged position').toBeLessThan(0.1);
  });
});
