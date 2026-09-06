import { describe, expect, it } from 'vitest';
import { formatMoreInstancesLabel, formatMoreReferencesLabel } from './references';

describe('formatMoreReferencesLabel', () => {
  it('renders a bare label before the count is known', () => {
    expect(formatMoreReferencesLabel(null, false)).toBe('More references');
  });

  it('renders the exact count', () => {
    expect(formatMoreReferencesLabel(42, false)).toBe('More references (42)');
  });

  it('renders a capped count as N+ — at least N, never a total', () => {
    expect(formatMoreReferencesLabel(1000, true)).toBe('More references (1000+)');
  });
});

describe('formatMoreInstancesLabel', () => {
  it('renders the shown/total ratio with an exact total', () => {
    expect(formatMoreInstancesLabel(25, 931)).toBe('More instances (25 of 931 shown)');
  });
});

import { instanceRowToSymbolInstance, overlayObjects } from './references';

const row = (id: string, object_id: string) => ({
  id,
  instance_type: 'containment',
  object_id,
  path: `/src/${object_id}.c`,
  project_id: 'p',
  start_offset: 1,
  end_offset: 2,
});

describe('instanceRowToSymbolInstance', () => {
  it('produces a renderable SymbolInstance keyed by the truncated symbol', () => {
    const inst = instanceRowToSymbolInstance(row('i9', 'o7'), 'sym1');
    expect(inst).toEqual({
      id: 'i9',
      symbol: 'sym1',
      object_id: 'o7',
      symbol_type: '',
      instance_type: 'containment',
      start_offset: 1,
      end_offset: 2,
    });
  });
});

describe('overlayObjects', () => {
  it('adds unknown objects without touching known ones, and is identity for no rows', () => {
    const base = new Map([['o1', { path: '/known.c', project_id: 'p' }]]);
    expect(overlayObjects(base, [])).toBe(base);
    const merged = overlayObjects(base, [row('i1', 'o1'), row('i2', 'o2')]);
    expect(merged.get('o1')?.path).toBe('/known.c');
    expect(merged.get('o2')?.path).toBe('/src/o2.c');
    expect(base.has('o2')).toBe(false);
  });
});
