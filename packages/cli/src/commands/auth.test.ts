import { describe, expect, it } from 'vitest';
import { DEFAULT_OBSERVE_PATH, describeSessionAge, observePathFrom } from './auth.js';

describe('observePathFrom', () => {
  it('does not observe when the flag is absent', () => {
    expect(observePathFrom(undefined)).toBeNull();
    expect(observePathFrom(false)).toBeNull();
  });

  it('uses the default contract path for a bare --observe', () => {
    expect(observePathFrom(true)).toBe(DEFAULT_OBSERVE_PATH);
  });

  it('honours an explicit path', () => {
    expect(observePathFrom('/tmp/anatomy.md')).toBe('/tmp/anatomy.md');
  });

  it('defaults into the gitignored contract folder, not into git', () => {
    // docs/tgr-contract/*.observed.md is gitignored on purpose (ADR-009): raw captures never
    // graduate to git automatically.
    expect(DEFAULT_OBSERVE_PATH).toMatch(/observed\.md$/);
    expect(DEFAULT_OBSERVE_PATH).toContain('tgr-contract');
  });
});

describe('describeSessionAge', () => {
  it('says nothing when the age is unknown', () => {
    expect(describeSessionAge(null)).toEqual([]);
  });

  it('states the age of a young session without warning about it', () => {
    expect(describeSessionAge(25)).toEqual(['Antigüedad: 25 min.']);
  });

  it('warns — without deciding — once the session is older than the measured ~1 hour', () => {
    const lines = describeSessionAge(38 * 24 * 60);
    expect(lines[0]).toBe('Antigüedad: 38 días.');
    expect(lines[1]).toMatch(/alrededor de una hora/);
    expect(lines[1]).toMatch(/probablemente/);
  });

  it('uses hours between an hour and two days', () => {
    expect(describeSessionAge(5 * 60 + 10)[0]).toBe('Antigüedad: 5 h.');
  });

  it('does not warn at exactly the measured lifetime', () => {
    expect(describeSessionAge(60)).toHaveLength(1);
  });
});
