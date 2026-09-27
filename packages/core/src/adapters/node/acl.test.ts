import { describe, expect, it } from 'vitest';
import { hardenDirCommand } from './acl.js';

describe('hardenDirCommand', () => {
  it('is a no-op off Windows — POSIX modes already do the job', () => {
    expect(hardenDirCommand('linux', '/home/u/.tgr', 'u')).toBeNull();
    expect(hardenDirCommand('darwin', '/Users/u/.tgr', 'u')).toBeNull();
  });

  it('builds the icacls argv on Windows', () => {
    expect(hardenDirCommand('win32', 'C:\\Users\\u\\.tgr', 'MACHINE\\u')).toEqual([
      'icacls',
      'C:\\Users\\u\\.tgr',
      '/inheritance:r',
      '/grant:r',
      'MACHINE\\u:(OI)(CI)F',
    ]);
  });

  it('emits nothing without a resolvable principal — a half-applied ACL grants no one', () => {
    expect(hardenDirCommand('win32', 'C:\\Users\\u\\.tgr', undefined)).toBeNull();
  });

  it('returns an argv ARRAY, never a shell string (no injection sink)', () => {
    const cmd = hardenDirCommand('win32', 'C:\\dir with spaces\\.tgr', 'u');
    expect(Array.isArray(cmd)).toBe(true);
    expect(cmd?.[1]).toBe('C:\\dir with spaces\\.tgr');
  });
});
