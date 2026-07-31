import { describe, it, expect } from 'vitest';
import { warningMessage } from './warnings';

describe('warningMessage', () => {
  it('appends suggestions for a typo', () => {
    expect(
      warningMessage({ message: '`"vfs_rea"` matched no symbols', suggestions: ['vfs_read', 'vfs_readv'] }),
    ).toBe('`"vfs_rea"` matched no symbols. Did you mean: vfs_read, vfs_readv?');
  });

  it('phrases name_exists when there are no suggestions', () => {
    const out = warningMessage({ message: '`"vfs_read"` matched no symbols', name_exists: true });
    expect(out).toContain('The name exists but wasn\'t matched here');
    expect(out).toContain('type');
    expect(out).not.toContain('Did you mean');
  });

  it('suggestions win over name_exists', () => {
    const out = warningMessage({ message: 'x', suggestions: ['y'], name_exists: true });
    expect(out).toBe('x. Did you mean: y?');
  });

  it('returns the base message when neither is present', () => {
    expect(warningMessage({ message: 'plain warning' })).toBe('plain warning');
    expect(warningMessage({})).toBe('Warning');
    expect(warningMessage({ message: 'x', suggestions: [] })).toBe('x');
  });
});
