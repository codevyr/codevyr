import { describe, it, expect } from 'vitest';
import { instancesQueryParams, markdownQueryParams, referencesQueryParams } from './askld';

describe('markdownQueryParams', () => {
  it('requests markdown format with the given projection', () => {
    expect(markdownQueryParams('signature')).toBe('format=markdown&projection=signature');
    expect(markdownQueryParams('names')).toBe('format=markdown&projection=names');
    expect(markdownQueryParams('body')).toBe('format=markdown&projection=body');
  });
});

describe('referencesQueryParams', () => {
  it('is empty for the first page with default limit', () => {
    expect(referencesQueryParams()).toBe('');
    expect(referencesQueryParams(null)).toBe('');
  });

  it('carries the opaque cursor back verbatim', () => {
    expect(referencesQueryParams('4001:123')).toBe('after=4001%3A123');
  });

  it('adds an explicit limit', () => {
    expect(referencesQueryParams(null, 10)).toBe('limit=10');
    expect(referencesQueryParams('1:2', 10)).toBe('after=1%3A2&limit=10');
  });
});

describe('instancesQueryParams', () => {
  it('is empty for the first page with default limit', () => {
    expect(instancesQueryParams()).toBe('');
    expect(instancesQueryParams(null)).toBe('');
  });

  it('carries the instance-id cursor and limit', () => {
    expect(instancesQueryParams(28055528)).toBe('after=28055528');
    expect(instancesQueryParams('7', 10)).toBe('after=7&limit=10');
  });
});
