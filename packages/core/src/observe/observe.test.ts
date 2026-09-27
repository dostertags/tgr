import { describe, expect, it } from 'vitest';
import type { SessionAnatomy } from '../seams/index.js';
import { redactUrl, renderAnatomyReport } from './observe.js';

describe('redactUrl', () => {
  it('strips the query — an OAuth terminal URL carries a live authorization code', () => {
    expect(
      redactUrl('https://www.tesoreria.cl/LoginPortalCognito/?code=SECRET&state=SECRET2'),
    ).toBe('https://www.tesoreria.cl/LoginPortalCognito/');
  });

  it('strips the hash too', () => {
    expect(redactUrl('https://www.tesoreria.cl/x#id_token=SECRET')).toBe(
      'https://www.tesoreria.cl/x',
    );
  });

  it('keeps origin and path, which is what the contract doc needs', () => {
    expect(redactUrl('https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/')).toBe(
      'https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/',
    );
  });

  it('does NOT echo an unparseable input — echoing what we could not parse is how a secret leaks', () => {
    expect(redactUrl('code=SECRET')).toBe('(url ilegible)');
  });
});

const ANATOMY: SessionAnatomy = {
  landedUrl: 'https://www.tesoreria.cl/LoginPortalCognito/',
  cookieNamesByDomain: {
    '.tgr.cl': ['XSRF-TOKEN', 'session-id'],
    'www.tesoreria.cl': ['JSESSIONID'],
  },
  storageKeyNamesByOrigin: {
    'https://www.tesoreria.cl': {
      localStorage: ['CognitoIdentityServiceProvider.abc.idToken'],
      sessionStorage: ['nav-state'],
    },
  },
};

describe('renderAnatomyReport', () => {
  const report = renderAnatomyReport(ANATOMY, { capturedAt: '2026-08-10T12:00:00.000Z' });

  it('records every observed cookie domain and name', () => {
    expect(report).toContain('.tgr.cl');
    expect(report).toContain('XSRF-TOKEN');
    expect(report).toContain('JSESSIONID');
  });

  it('records storage key names per origin', () => {
    expect(report).toContain('CognitoIdentityServiceProvider.abc.idToken');
    expect(report).toContain('nav-state');
  });

  it('states loudly that it holds names only', () => {
    expect(report).toContain('Solo NOMBRES');
  });

  it('reports the ADR-005 answer when it is known', () => {
    const yes = renderAnatomyReport(ANATOMY, {
      capturedAt: '2026-08-10T12:00:00.000Z',
      restoredFromCookiesOnly: true,
    });
    expect(yes).toContain('**SÍ**');
    const no = renderAnatomyReport(ANATOMY, {
      capturedAt: '2026-08-10T12:00:00.000Z',
      restoredFromCookiesOnly: false,
    });
    expect(no).toContain('**NO**');
  });

  it('omits the ADR-005 line entirely when it was not determined', () => {
    expect(report).not.toContain('cookies-only revivió');
  });

  it('renders an empty capture without crashing', () => {
    const empty = renderAnatomyReport(
      {
        landedUrl: 'https://www.tesoreria.cl/',
        cookieNamesByDomain: {},
        storageKeyNamesByOrigin: {},
      },
      { capturedAt: '2026-08-10T12:00:00.000Z' },
    );
    expect(empty).toContain('_(ninguna)_');
    expect(empty).toContain('_(ninguno)_');
  });
});
