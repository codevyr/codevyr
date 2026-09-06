import { describe, expect, it } from 'vitest';
import { encodeQuery } from '../lib/query_share';
import { pickInitialQuery } from './initial_query';

// The ONE place that decides which query the editor opens with.
// Priority, in order: #q= share link, saved query, default.
describe('pickInitialQuery', () => {
  const saved = '"saved_query"';
  const fallback = '"default_query"';

  it('a #q= share link always wins', () => {
    const hash = `#q=${encodeQuery('"from_link"')}`;
    expect(pickInitialQuery(hash, saved, fallback)).toBe('"from_link"');
    expect(pickInitialQuery(hash, null, fallback)).toBe('"from_link"');
  });

  it('the saved query wins when there is no share link', () => {
    expect(pickInitialQuery('', saved, fallback)).toBe(saved);
    expect(pickInitialQuery(null, saved, fallback)).toBe(saved);
    expect(pickInitialQuery('#other=1', saved, fallback)).toBe(saved);
  });

  it('a malformed share link falls through to the saved query', () => {
    expect(pickInitialQuery('#q=%%%not-lz%%%', saved, fallback)).toBe(saved);
  });

  it('the default is last', () => {
    expect(pickInitialQuery(null, null, fallback)).toBe(fallback);
  });
});
