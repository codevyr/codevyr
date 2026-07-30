import { describe, it, expect } from 'vitest';
import { markdownQueryParams } from './askld';

describe('markdownQueryParams', () => {
  it('requests markdown format with the given projection', () => {
    expect(markdownQueryParams('signature')).toBe('format=markdown&projection=signature');
    expect(markdownQueryParams('names')).toBe('format=markdown&projection=names');
    expect(markdownQueryParams('body')).toBe('format=markdown&projection=body');
  });
});
