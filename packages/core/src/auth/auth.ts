import {
  DEFAULT_SETTINGS,
  DESTINATIONS,
  SESSION_PROBE_URL,
  hasCompletedExchange,
  isAuthenticatedLanding,
} from '../config/index.js';
import type { LoginDestination } from '../config/index.js';
import { LoginFailedError } from '../errors/index.js';
import { recordAudit } from '../audit/index.js';
import { readIdentity } from '../portal/index.js';
import type { TgrIdentity } from '../portal/index.js';
import type { PortalSession, Runtime, SessionAnatomy } from '../seams/index.js';
import { deleteSession, readSession, writeSession } from './session.js';

/** Best-effort identity read (ADR-010). The caller must already be on the settled, authenticated
 *  cartola page. ANY failure degrades to null: a login must NEVER fail because the identity
 *  lookup did — the session is valid either way, and "unknown" is an honest answer.
 *
 *  Only the RUT reaches the audit receipt. Razón social is PII and stays off it. */
async function resolveIdentity(
  runtime: Runtime,
  session: PortalSession,
): Promise<TgrIdentity | null> {
  try {
    const identity = await readIdentity(session);
    recordAudit(runtime, {
      action: 'identity_read',
      result: identity ? 'ok' : 'not_found',
      rut: identity?.rut ?? null,
    });
    return identity;
  } catch {
    recordAudit(runtime, { action: 'identity_read', result: 'failed' });
    return null;
  }
}

export interface AuthStatusLocal {
  /** LOCAL-only: a session file exists on disk. NOT a server-side liveness claim. */
  readonly authenticated: boolean;
  readonly rut: string | null;
  /** PII, read from local state only — `auth status` never calls the portal. */
  readonly razonSocial: string | null;
  readonly idp: string | null;
  readonly sessionSource: 'cached' | 'none';
  readonly savedAt: string | null;
  /** Whole minutes since the session was saved, from the injected clock. A HINT for the user —
   *  never a liveness verdict: TGR stays the authority, and no local TTL gate exists by design
   *  (docs/tgr-contract/auth-login.md). Null when there is no session or `savedAt` is unreadable. */
  readonly ageMinutes: number | null;
}

export interface AuthLoginResult {
  readonly authenticated: true;
  /** Portal-asserted RUT (ADR-008/ADR-010). Null when the identity could not be read — a login
   *  is still valid without it, and "unknown" is preferable to a guess. */
  readonly rut: string | null;
  /** PII. Present because the user asked to log in as this entity and should see which one. */
  readonly razonSocial: string | null;
  /** Which IdP authenticated (`ClaveTributaria` shares its lockout counter with `sii`). */
  readonly idp: string | null;
  readonly reason: 'browser_login' | 'already_authenticated';
  /** Whether the stored cookies-only jar revived a live session. THE open question of ADR-005.
   *  Only present when a stored jar existed to try. */
  readonly restoredFromCookiesOnly?: boolean;
  /** Present only when `observe` was requested (ADR-009). Names only, never values. */
  readonly anatomy?: SessionAnatomy;
}

export interface AuthLogoutResult {
  readonly loggedOut: boolean;
  /** Always `false` in v1, and that is a statement rather than a stub: no server-side logout
   *  endpoint has been identified on TGR yet (docs/tgr-contract/auth-login.md). Local state is
   *  wiped; the server-side session may remain valid until it expires on its own. Surfaced
   *  explicitly so nobody mistakes a local wipe for a real sign-out. */
  readonly serverClosed: false;
}

export interface LoginOptions {
  /** Capture the session's shape into the result (ADR-009). Names only. */
  readonly observe?: boolean;
  readonly destination?: LoginDestination;
}

/** Floor to whole minutes; clamp clock skew to 0; unknown rather than wrong for a bad timestamp. */
function ageInMinutes(savedAt: string, now: Date): number | null {
  const saved = Date.parse(savedAt);
  if (Number.isNaN(saved)) return null;
  return Math.max(0, Math.floor((now.getTime() - saved) / 60_000));
}

/** Pure local read — NO portal call. */
export async function localStatus(runtime: Runtime): Promise<AuthStatusLocal> {
  const session = await readSession(runtime.store);
  return session
    ? {
        authenticated: true,
        rut: session.rut,
        razonSocial: session.razonSocial ?? null,
        idp: session.idp ?? null,
        sessionSource: 'cached',
        savedAt: session.savedAt,
        ageMinutes: ageInMinutes(session.savedAt, runtime.clock.now()),
      }
    : {
        authenticated: false,
        rut: null,
        razonSocial: null,
        idp: null,
        sessionSource: 'none',
        savedAt: null,
        ageMinutes: null,
      };
}

/** Is the stored jar still good? Probes a PROTECTED page (`SESSION_PROBE_URL`): with a session it
 *  redirects to the authenticated site (`web.tesoreria.cl`), without one it bounces out to the
 *  IdP picker on `autentica.tgr.cl`.
 *
 *  It deliberately does NOT probe the login entry. Doing so was a real bug: re-entering the login
 *  flow while already authenticated renders "TGR - Sesión expirada" whatever the session's actual
 *  state, so a perfectly good session read as dead (observed 2026-08-10).
 *
 *  Never throws — the login path needs "is it warm?", not an error. */
async function reuseLiveSession(
  runtime: Runtime,
  url: string,
  observe: boolean,
): Promise<AuthLoginResult | null> {
  const stored = await readSession(runtime.store);
  if (!stored) return null;

  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.restore(stored.cookies);
    const landed = await session.goto(url);
    if (!isAuthenticatedLanding(landed)) return null;
    const anatomy = observe ? await session.anatomy() : undefined;

    // We are standing on the authenticated cartola page, which is exactly where the identity is
    // readable — so backfill it if an older jar predates identity support, or if a previous read
    // came up empty. Cheap: no extra navigation.
    const identity = stored.rut === null ? await resolveIdentity(runtime, session) : null;
    if (identity) {
      await writeSession(runtime.store, {
        ...stored,
        rut: identity.rut,
        razonSocial: identity.razonSocial,
        idp: identity.idp,
      });
    }
    const rut = identity?.rut ?? stored.rut;

    recordAudit(runtime, {
      action: 'auth_login',
      result: 'ok',
      rut,
      reason: 'already_authenticated',
      restoredFromCookiesOnly: true,
    });
    return {
      authenticated: true,
      rut,
      razonSocial: identity?.razonSocial ?? stored.razonSocial ?? null,
      idp: identity?.idp ?? stored.idp ?? null,
      reason: 'already_authenticated',
      restoredFromCookiesOnly: true,
      ...(anatomy ? { anatomy } : {}),
    };
  } catch {
    return null;
  } finally {
    await session?.close();
  }
}

/** Turn a freshly-minted PortalSession into a persisted session: confirm we really are on a
 *  terminal APP origin, persist cookies (NO secret), and hand back the anatomy when asked.
 *
 *  The anatomy capture runs unconditionally because it doubles as the postcondition check — the
 *  driver already waited for an APP host, and `anatomy().landedUrl` is how the core verifies that
 *  independently without spending another navigation. It is only RETURNED when `observe` is set. */
async function finalizeFreshSession(
  runtime: Runtime,
  session: PortalSession,
  start: number,
  observe: boolean,
): Promise<AuthLoginResult> {
  const anatomy = await session.anatomy();
  if (!isAuthenticatedLanding(anatomy.landedUrl)) {
    throw new LoginFailedError(
      'Login no completado: el navegador no llegó a un destino autenticado de la TGR ' +
        `(quedó en ${anatomy.landedUrl}). No se guardó ninguna sesión.`,
    );
  }
  // Second, independent post-condition (ADR-003 amended): the landing predicate alone would
  // accept the PUBLIC tgr.gob.cl CMS, which both the IdP picker and the expired page link to
  // ("Ir a tgr.cl"). A context that never ran the Cognito exchange has no `userCognito` cookie,
  // so this closes that hole. The context started empty, which is what makes its presence mean
  // something here — it is NOT a liveness test (it outlives the session).
  if (!hasCompletedExchange(anatomy.cookieNamesByDomain)) {
    throw new LoginFailedError(
      'Login no completado: el navegador llegó a un origen de la TGR pero el intercambio ' +
        'OAuth nunca se completó (falta la cookie de sesión del portal). No se guardó nada.',
    );
  }

  // The login terminus is TGR's own broken-redirect 404, which carries no identity. Step over to
  // the authenticated cartola page — settled — where the hand-off link does (ADR-010).
  // The login itself is already proven above; identity is optional (a null rut is backfilled by
  // the next warm reuse). A slow probe page must never discard a completed login — observed
  // 2026-09-26: tgr.gob.cl took 21–64s to reach DOMContentLoaded and the session was thrown away.
  const landed = await session.goto(SESSION_PROBE_URL).catch(() => null);
  const identity =
    landed !== null && isAuthenticatedLanding(landed)
      ? await resolveIdentity(runtime, session)
      : null;

  const cookies = await session.storageState();
  await writeSession(runtime.store, {
    rut: identity?.rut ?? null,
    razonSocial: identity?.razonSocial ?? null,
    idp: identity?.idp ?? null,
    cookies,
    savedAt: runtime.clock.now().toISOString(),
  });

  recordAudit(runtime, {
    action: 'auth_login',
    result: 'ok',
    rut: identity?.rut ?? null,
    reason: 'browser_login',
    durationMs: runtime.clock.now().getTime() - start,
  });
  return {
    authenticated: true,
    rut: identity?.rut ?? null,
    razonSocial: identity?.razonSocial ?? null,
    idp: identity?.idp ?? null,
    reason: 'browser_login',
    ...(observe ? { anatomy } : {}),
  };
}

/** Interactive, IdP-agnostic browser login (ADR-003). The ONLY path that mints a session in v1.
 *  Idempotent: a live cached session returns `already_authenticated` without opening a window.
 *
 *  The clave never enters this process — the user types it into the IdP's own page. */
export async function login(
  runtime: Runtime,
  options: LoginOptions = {},
): Promise<AuthLoginResult> {
  const start = runtime.clock.now().getTime();
  const destination = options.destination ?? DESTINATIONS.cartolaFiscal;
  const observe = options.observe ?? false;

  const warm = await reuseLiveSession(runtime, SESSION_PROBE_URL, observe);
  if (warm) return warm;

  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.interactiveLogin({
      destination,
      timeoutMs: DEFAULT_SETTINGS.loginTimeoutMs,
    });
    return await finalizeFreshSession(runtime, session, start, observe);
  } catch (err) {
    recordAudit(runtime, { action: 'auth_login', result: 'failed', reason: 'browser_login' });
    throw err;
  } finally {
    await session?.close();
  }
}

/** Wipe local session state. See `AuthLogoutResult.serverClosed` — this does NOT close the
 *  session on TGR's side, because no logout endpoint has been observed yet. */
export async function logout(runtime: Runtime): Promise<AuthLogoutResult> {
  const session = await readSession(runtime.store);
  if (!session) {
    recordAudit(runtime, { action: 'logout', result: 'ok', serverClosed: false });
    return { loggedOut: false, serverClosed: false };
  }
  await deleteSession(runtime.store);
  recordAudit(runtime, { action: 'logout', result: 'ok', rut: session.rut, serverClosed: false });
  return { loggedOut: true, serverClosed: false };
}
