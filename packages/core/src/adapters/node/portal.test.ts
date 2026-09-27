import { describe, expect, it } from 'vitest';
import { NotAuthenticatedError, PortalTimeoutError, TgrError } from '../../errors/index.js';
import { toPortalTimeout } from './portal.js';

/** Playwright's TimeoutError, by name — importing `playwright` here would defeat the lazy load. */
function playwrightTimeout(message: string): Error {
  return Object.assign(new Error(message), { name: 'TimeoutError' });
}

describe('toPortalTimeout', () => {
  it('turns a raw Playwright timeout into a Spanish domain error (regression)', () => {
    // Observed 2026-09-26: `page.goto: Timeout 30000ms exceeded.` reached the user verbatim.
    const mapped = toPortalTimeout(
      playwrightTimeout('page.goto: Timeout 30000ms exceeded.'),
      'https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/',
    );

    expect(mapped).toBeInstanceOf(PortalTimeoutError);
    expect(mapped.message).toMatch(/TGR no respondió a tiempo/);
    expect(mapped.message).toContain('tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/');
    expect(mapped.message).not.toMatch(/Timeout \d+ms exceeded/);
  });

  it('never puts a query string in the message — a shell URL can carry a signed vr hand-off', () => {
    const mapped = toPortalTimeout(
      playwrightTimeout('page.goto: Timeout'),
      'https://web.tesoreria.cl/tramites-tgr/x/?go=https://www.tesoreria.cl/r?vr=SECRETTOKEN',
    );

    expect(mapped.message).not.toContain('SECRETTOKEN');
    expect(mapped.message).not.toContain('?');
  });

  it('passes any other error through untouched', () => {
    const original = new Error('net::ERR_NAME_NOT_RESOLVED');
    expect(toPortalTimeout(original, 'https://tgr.gob.cl/')).toBe(original);
  });

  it('is a TgrError but NOT "not authenticated" — a slow portal must not send you to log in', () => {
    const mapped = toPortalTimeout(playwrightTimeout('x'), 'https://tgr.gob.cl/');
    expect(mapped).toBeInstanceOf(TgrError);
    expect(mapped).not.toBeInstanceOf(NotAuthenticatedError);
  });
});
