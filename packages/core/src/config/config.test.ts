import { describe, expect, it } from 'vitest';
import {
  APP_HOSTS,
  AUTH_HOSTS,
  DEFAULT_SETTINGS,
  DESTINATIONS,
  hasCompletedExchange,
  isAppHost,
  isAuthHost,
  isAuthenticatedLanding,
  loginUrl,
} from './config.js';

describe('origin classification (ADR-003)', () => {
  it('treats the terminal app origins as authenticated landings', () => {
    expect(isAppHost('https://www.tesoreria.cl/LoginPortalCognito/')).toBe(true);
    expect(isAppHost('https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/')).toBe(true);
  });

  it('does NOT treat any federated IdP waypoint as authenticated', () => {
    // This is the whole point of ADR-003: the companion sii tool's "left the login host" rule
    // would call each of these a success, and mint a session from an unauthenticated page.
    for (const host of AUTH_HOSTS) {
      expect(isAppHost(`https://${host}/whatever`), host).toBe(false);
    }
  });

  it('recognises the waypoints as auth origins', () => {
    expect(isAuthHost('https://autentica.tgr.cl/oauth2/authorize-front')).toBe(true);
    expect(isAuthHost('https://www2.sii.cl/oauthsii-v1-org/')).toBe(true);
    expect(isAuthHost('https://accounts.claveunica.gob.cl/accounts/login/')).toBe(true);
    expect(isAuthHost('https://www.tesoreria.cl/')).toBe(false);
  });

  it('the app and auth sets are disjoint', () => {
    for (const host of APP_HOSTS) expect(AUTH_HOSTS.has(host)).toBe(false);
  });

  it('fails closed on an unparseable URL', () => {
    expect(isAppHost('://nonsense')).toBe(false);
    expect(isAuthHost('://nonsense')).toBe(false);
  });

  it('does not match a subdomain that merely ends with an app host name', () => {
    expect(isAppHost('https://tgr.gob.cl.evil.example/')).toBe(false);
  });
});

describe('isAuthenticatedLanding (ADR-003 as amended)', () => {
  it('accepts a real destination on an app origin', () => {
    expect(isAuthenticatedLanding('https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/')).toBe(true);
    expect(isAuthenticatedLanding('https://www.tesoreria.cl/algo')).toBe(true);
  });

  it('accepts the authenticated site, web.tesoreria.cl', () => {
    // Discovered 2026-08-10 by restoring a real session into a headed browser. Nothing on the
    // public site links here, and omitting it made every live session look dead.
    expect(isAuthenticatedLanding('https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/')).toBe(
      true,
    );
  });

  it('accepts the /null 404 — TGR’s broken redirect IS what success looks like', () => {
    // Observed 2026-08-10, twice: after a successful auth the portal navigates to
    // `/LoginPortalCognito/` + a null destination variable and 404s. There is no onward redirect
    // to wait for; requiring one made login impossible.
    expect(isAuthenticatedLanding('https://www.tesoreria.cl/LoginPortalCognito/null')).toBe(true);
  });

  it('REJECTS the entry path, where TGR serves "Sesión expirada" (regression)', () => {
    // Same origin, same app, one path apart. An origin-only check accepted this and reported a
    // dead session as `already_authenticated`.
    expect(isAppHost('https://www.tesoreria.cl/LoginPortalCognito/login')).toBe(true);
    expect(isAuthenticatedLanding('https://www.tesoreria.cl/LoginPortalCognito/login')).toBe(false);
  });

  it('rejects every auth-origin waypoint', () => {
    for (const host of AUTH_HOSTS) {
      expect(isAuthenticatedLanding(`https://${host}/whatever`), host).toBe(false);
    }
  });

  it('fails closed on an unparseable URL', () => {
    expect(isAuthenticatedLanding('://nonsense')).toBe(false);
  });

  it('rejects the login entry itself — the thing we navigate to in order to start', () => {
    expect(isAuthenticatedLanding(loginUrl(DESTINATIONS.cartolaFiscal))).toBe(false);
  });
});

describe('hasCompletedExchange', () => {
  it('is true only when the portal cookie from a completed exchange is present', () => {
    expect(hasCompletedExchange({ 'www.tesoreria.cl': ['JSESSIONID', 'userCognito'] })).toBe(true);
  });

  it('is false for a context that only ever saw the public CMS', () => {
    // The hole that `isAuthenticatedLanding` alone cannot close: tgr.gob.cl is public and both
    // the IdP picker and the expired page link to it.
    expect(hasCompletedExchange({})).toBe(false);
    expect(hasCompletedExchange({ '.tgr.cl': ['_ga', '_hjSession_5176501'] })).toBe(false);
  });

  it('does not accept the cookie on the wrong domain', () => {
    expect(hasCompletedExchange({ '.tgr.cl': ['userCognito'] })).toBe(false);
  });
});

describe('loginUrl', () => {
  it('builds the observed entry format with sp percent-encoded', () => {
    expect(loginUrl(DESTINATIONS.cartolaFiscal)).toBe(
      'https://www.tesoreria.cl/LoginPortalCognito/login' +
        '?go=cf12_w12&sp=%2Ftramites-tgr%2Fmi-cartola-fiscal%2F',
    );
  });

  it('points at an app host, never an auth or payment host', () => {
    expect(isAppHost(loginUrl(DESTINATIONS.cartolaFiscal))).toBe(true);
  });
});

describe('settings', () => {
  it('gives the headed login a longer budget than a single-form portal would need', () => {
    // More hops, plus the user has to CHOOSE an IdP first (ADR-003).
    expect(DEFAULT_SETTINGS.loginTimeoutMs).toBe(300_000);
  });

  it('paces at ~1 rps', () => {
    expect(DEFAULT_SETTINGS.rateLimitRps).toBe(1);
  });
});
