import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_ANATOMY,
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
  type FakeDriverScript,
} from '../adapters/fake/index.js';
import { LoginFailedError } from '../errors/index.js';
import type { Runtime, SessionAnatomy } from '../seams/index.js';
import { localStatus, login, logout } from './auth.js';
import { readSession, writeSession } from './session.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

// The IdP picker — an AUTH origin. Landing here means NOT authenticated (ADR-003).
const AUTH_LANDING = 'https://autentica.tgr.cl/oauth2/authorize-front';
// The REAL terminus of a successful TGR login (observed 2026-08-10, twice): their post-auth
// redirect resolves the destination to the literal string `null` and 404s. Ugly, but it is what
// success looks like.
const APP_LANDING = 'https://www.tesoreria.cl/LoginPortalCognito/null';
// "TGR - Sesión expirada" — served at the SAME path as the login entry, on an APP origin. This
// is the false positive that a bare origin check accepted, reporting a dead session as live.
const EXPIRED_LANDING = 'https://www.tesoreria.cl/LoginPortalCognito/login';
// The public CMS. An APP origin that the IdP picker and the expired page both link to
// ("Ir a tgr.cl") — reachable WITHOUT any session, hence the second post-condition.
const PUBLIC_CMS_LANDING = 'https://tgr.gob.cl/';

function build(script: FakeDriverScript = {}) {
  const clock = new FixedClock(NOW);
  const audit = new RecordingAuditSink();
  const store = new InMemoryKeyValueStore();
  const portal = new FakePortalDriver(script);
  const runtime: Runtime = { clock, audit, store, portal };
  return { runtime, clock, audit, store, portal };
}

describe('localStatus', () => {
  it('reports no session when nothing is stored', async () => {
    const { runtime } = build();
    expect(await localStatus(runtime)).toEqual({
      authenticated: false,
      rut: null,
      razonSocial: null,
      idp: null,
      sessionSource: 'none',
      savedAt: null,
      ageMinutes: null,
    });
  });

  it('reports how old the stored session is, from the injected clock', async () => {
    // A 38-day-old jar read as a plain "sesión guardada" on 2026-09-26 — nothing hinted it was dead.
    const { runtime, store } = build();
    const savedAt = new Date(NOW.getTime() - 38 * 24 * 60 * 60_000).toISOString();
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt });

    expect((await localStatus(runtime)).ageMinutes).toBe(38 * 24 * 60);
  });

  it('rounds the age down to whole minutes, and never reports a negative age', async () => {
    const { runtime, store, clock } = build();
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    clock.set(new Date(NOW.getTime() + 90_000));
    expect((await localStatus(runtime)).ageMinutes).toBe(1);

    clock.set(new Date(NOW.getTime() - 5 * 60_000)); // clock skew: saved "in the future"
    expect((await localStatus(runtime)).ageMinutes).toBe(0);
  });

  it('reports an unknown age rather than a wrong one when savedAt is unreadable', async () => {
    const { runtime, store } = build();
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: 'garbage' });

    expect((await localStatus(runtime)).ageMinutes).toBeNull();
  });

  it('is a pure local read — it never touches the portal', async () => {
    const { runtime, store, portal } = build();
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });
    const status = await localStatus(runtime);
    expect(status.authenticated).toBe(true);
    expect(status.sessionSource).toBe('cached');
    expect(portal.restoreCalls).toBe(0);
    expect(portal.interactiveLoginCalls).toBe(0);
  });
});

describe('login — fresh', () => {
  it('opens the browser and persists a cookies-only session', async () => {
    const { runtime, store, portal } = build({ loginSession: { landingUrl: APP_LANDING } });

    const result = await login(runtime);

    expect(portal.interactiveLoginCalls).toBe(1);
    expect(result.reason).toBe('browser_login');
    expect(result.authenticated).toBe(true);

    const stored = await readSession(store);
    expect(stored?.savedAt).toBe(NOW.toISOString());
    expect(stored?.cookies).toEqual({ cookies: [] });
  });

  it('leaves the RUT null rather than inventing one (ADR-008 is unresolved)', async () => {
    const { runtime, store } = build({ loginSession: { landingUrl: APP_LANDING } });
    const result = await login(runtime);
    expect(result.rut).toBeNull();
    expect((await readSession(store))?.rut).toBeNull();
  });

  it('REFUSES to mint a session when the browser did not reach an app origin', async () => {
    // Fail closed: still sitting on the IdP picker means the user never authenticated.
    const { runtime, store } = build({ loginSession: { landingUrl: AUTH_LANDING } });

    await expect(login(runtime)).rejects.toThrow(LoginFailedError);
    expect(await readSession(store)).toBeNull();
  });

  it('REFUSES to mint a session from the expired/entry page (regression)', async () => {
    // TGR serves "Sesión expirada" at the login entry path on an APP origin. An origin-only
    // check accepted it and failed OPEN.
    const { runtime, store } = build({ loginSession: { landingUrl: EXPIRED_LANDING } });

    await expect(login(runtime)).rejects.toThrow(LoginFailedError);
    expect(await readSession(store)).toBeNull();
  });

  it('REFUSES to mint a session from the public CMS, where no exchange ever ran', async () => {
    // Landing predicate alone would accept tgr.gob.cl. The exchange post-condition must not.
    const { runtime, store } = build({
      loginSession: {
        landingUrl: PUBLIC_CMS_LANDING,
        anatomy: { ...EMPTY_ANATOMY, landedUrl: PUBLIC_CMS_LANDING },
      },
    });

    await expect(login(runtime)).rejects.toThrow(/intercambio/i);
    expect(await readSession(store)).toBeNull();
  });

  it('propagates a driver failure and writes no partial session', async () => {
    const { runtime, store, audit } = build({ failLogin: new LoginFailedError('ventana cerrada') });

    await expect(login(runtime)).rejects.toThrow('ventana cerrada');
    expect(await readSession(store)).toBeNull();
    expect(audit.entries.at(-1)).toMatchObject({ action: 'auth_login', result: 'failed' });
  });

  it('always closes the browser', async () => {
    const { runtime, portal } = build({ loginSession: { landingUrl: APP_LANDING } });
    await login(runtime);
    expect(portal.sessions.every((s) => s.closed)).toBe(true);
  });
});

describe('login — warm session (the ADR-005 probe)', () => {
  beforeEach(() => {
    // nothing shared; each test builds its own runtime
  });

  it('reuses a live jar without opening a window, and reports the cookies-only verdict', async () => {
    const { runtime, store, portal } = build({ restoreSession: { landingUrl: APP_LANDING } });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime);

    expect(result.reason).toBe('already_authenticated');
    expect(result.restoredFromCookiesOnly).toBe(true);
    expect(portal.interactiveLoginCalls).toBe(0);
    expect(portal.restoreCalls).toBe(1);
  });

  it('falls through to the browser when the restored jar bounces to the IdP picker', async () => {
    const { runtime, store, portal } = build({
      restoreSession: { landingUrl: AUTH_LANDING },
      loginSession: { landingUrl: APP_LANDING },
    });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime);

    expect(result.reason).toBe('browser_login');
    expect(portal.interactiveLoginCalls).toBe(1);
  });

  it('does NOT call a dead session warm when TGR serves its expired page on an app origin', async () => {
    // The exact false positive observed 2026-08-10: the jar was sent, TGR answered
    // "TGR - Sesión expirada" at /LoginPortalCognito/login — an APP origin — and an origin-only
    // check reported already_authenticated for a session that was gone.
    const { runtime, store, portal } = build({
      restoreSession: { landingUrl: EXPIRED_LANDING },
      loginSession: { landingUrl: APP_LANDING },
    });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime);

    expect(result.reason).toBe('browser_login');
    expect(portal.interactiveLoginCalls).toBe(1);
  });

  it('falls through when restore itself fails, instead of surfacing the error', async () => {
    const { runtime, store, portal } = build({
      failRestore: new Error('cookie jar unusable'),
      loginSession: { landingUrl: APP_LANDING },
    });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime);

    expect(result.reason).toBe('browser_login');
    expect(portal.interactiveLoginCalls).toBe(1);
  });

  it('does not attempt a restore when nothing is stored', async () => {
    const { runtime, portal } = build({ loginSession: { landingUrl: APP_LANDING } });
    await login(runtime);
    expect(portal.restoreCalls).toBe(0);
  });
});

describe('login — observe (ADR-009)', () => {
  const ANATOMY: SessionAnatomy = {
    landedUrl: APP_LANDING,
    // Mirrors the live 2026-08-10 capture: the portal cookies live on www.tesoreria.cl, and
    // .tgr.cl carries only analytics.
    cookieNamesByDomain: {
      'www.tesoreria.cl': ['JSESSIONID', 'userCognito'],
      '.tgr.cl': ['_ga'],
    },
    storageKeyNamesByOrigin: {
      'https://www.tesoreria.cl': {
        localStorage: ['CognitoIdentityServiceProvider.x.idToken'],
        sessionStorage: [],
      },
    },
  };

  it('returns the anatomy only when asked', async () => {
    const { runtime } = build({ loginSession: { landingUrl: APP_LANDING, anatomy: ANATOMY } });
    expect((await login(runtime)).anatomy).toBeUndefined();

    const { runtime: r2 } = build({ loginSession: { landingUrl: APP_LANDING, anatomy: ANATOMY } });
    expect((await login(r2, { observe: true })).anatomy).toEqual(ANATOMY);
  });

  it('captures the anatomy on the warm path too — that is where the ADR-005 answer lives', async () => {
    const { runtime, store } = build({
      restoreSession: { landingUrl: APP_LANDING, anatomy: ANATOMY },
    });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime, { observe: true });

    expect(result.anatomy).toEqual(ANATOMY);
    expect(result.restoredFromCookiesOnly).toBe(true);
  });

  it('still verifies the landing even without --observe', async () => {
    // finalize captures the anatomy unconditionally and uses it as the postcondition check, so a
    // bad landing is caught whether or not the caller asked to see it.
    const { runtime } = build({ loginSession: { landingUrl: AUTH_LANDING } });
    await expect(login(runtime)).rejects.toThrow(LoginFailedError);
  });
});

describe('identity resolution (ADR-010)', () => {
  // SYNTHETIC. Same shape as the live hand-off link; 77777777-7 is a valid Mod-11 RUT.
  const VR = Buffer.from(
    [
      'a'.repeat(32),
      '2026-08-10T19:55:23Z',
      '77777777',
      'b'.repeat(32),
      '/CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=77777777&DV=7',
      'ClaveTributaria',
    ].join(','),
    'utf8',
  ).toString('base64');
  const HANDOFF =
    'https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/' +
    `?go=https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=${VR}` +
    '&no=Empresa+Ficticia+SpA&ap=';

  const withHandoff = { landingUrl: APP_LANDING, evaluate: () => [HANDOFF, 'https://tgr.gob.cl/'] };
  const withoutHandoff = { landingUrl: APP_LANDING, evaluate: () => ['https://tgr.gob.cl/'] };

  it('reads the RUT, razón social and IdP on a fresh login and persists them', async () => {
    const { runtime, store } = build({ loginSession: withHandoff });

    const result = await login(runtime);

    expect(result).toMatchObject({
      rut: '77777777-7',
      razonSocial: 'Empresa Ficticia SpA',
      idp: 'ClaveTributaria',
    });
    const stored = await readSession(store);
    expect(stored?.rut).toBe('77777777-7');
    expect(stored?.idp).toBe('ClaveTributaria');
  });

  it('still succeeds when no identity can be read — the session is valid either way', async () => {
    const { runtime, store } = build({ loginSession: withoutHandoff });

    const result = await login(runtime);

    expect(result.authenticated).toBe(true);
    expect(result.rut).toBeNull();
    expect(await readSession(store)).not.toBeNull();
  });

  it('never fails a login because the identity read threw', async () => {
    const { runtime } = build({
      loginSession: {
        landingUrl: APP_LANDING,
        evaluate: () => {
          throw new Error('page went away');
        },
      },
    });

    await expect(login(runtime)).resolves.toMatchObject({ authenticated: true, rut: null });
  });

  it('KEEPS a completed login when the identity page times out (regression)', async () => {
    // Observed 2026-09-26: tgr.gob.cl took 21–64s to reach DOMContentLoaded, the probe navigation
    // timed out AFTER the user had logged in, and the whole session was discarded — twice.
    const { runtime, store, audit } = build({
      loginSession: {
        landingUrl: APP_LANDING,
        failGoto: () => new Error('page.goto: Timeout 30000ms exceeded.'),
      },
    });

    const result = await login(runtime);

    expect(result).toMatchObject({ authenticated: true, reason: 'browser_login', rut: null });
    expect(await readSession(store)).not.toBeNull();
    expect(audit.entries.at(-1)).toMatchObject({ action: 'auth_login', result: 'ok' });
  });

  it('backfills identity on the warm path for a jar minted before identity support', async () => {
    const { runtime, store } = build({ restoreSession: withHandoff });
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await login(runtime);

    expect(result.reason).toBe('already_authenticated');
    expect(result.rut).toBe('77777777-7');
    expect((await readSession(store))?.rut).toBe('77777777-7');
  });

  it('does not re-read identity when the jar already carries it', async () => {
    const { runtime, store } = build({ restoreSession: withHandoff });
    await writeSession(store, {
      rut: '77777777-7',
      razonSocial: 'Empresa Ficticia SpA',
      idp: 'ClaveTributaria',
      cookies: { cookies: [] },
      savedAt: NOW.toISOString(),
    });

    const result = await login(runtime);

    expect(result.rut).toBe('77777777-7');
    expect(result.razonSocial).toBe('Empresa Ficticia SpA');
  });

  it('keeps razón social OUT of the audit receipt', async () => {
    const { runtime, audit } = build({ loginSession: withHandoff });
    await login(runtime);

    const json = JSON.stringify(audit.entries);
    expect(json).toContain('77777777-7'); // a RUT is not a secret
    expect(json).not.toContain('Empresa Ficticia SpA'); // PII stays off the receipt
  });
});

describe('logout', () => {
  it('wipes a stored session and is explicit that the server side stays open', async () => {
    const { runtime, store } = build();
    await writeSession(store, { rut: null, cookies: { cookies: [] }, savedAt: NOW.toISOString() });

    const result = await logout(runtime);

    expect(result).toEqual({ loggedOut: true, serverClosed: false });
    expect(await readSession(store)).toBeNull();
  });

  it('is a no-op when there was no session', async () => {
    const { runtime } = build();
    expect(await logout(runtime)).toEqual({ loggedOut: false, serverClosed: false });
  });
});

describe('audit', () => {
  it('records a login receipt with no secret material', async () => {
    const { runtime, audit } = build({ loginSession: { landingUrl: APP_LANDING } });
    await login(runtime);

    const entry = audit.entries.at(-1)!;
    expect(entry).toMatchObject({ action: 'auth_login', result: 'ok', reason: 'browser_login' });
    const json = JSON.stringify(audit.entries);
    for (const forbidden of ['clave', 'password', 'cookie', 'token']) {
      expect(json.toLowerCase()).not.toContain(forbidden);
    }
  });
});
