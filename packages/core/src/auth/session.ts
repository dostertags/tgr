import { NotAuthenticatedError } from '../errors/index.js';
import type { KeyValueStore, PortalSession, Runtime } from '../seams/index.js';

// Distinct KeyValueStore key so this module never shares a file with another concern.
const SESSION_KEY = 'session';

export interface StoredSession {
  /** The session principal's canonical RUT — **asserted by the portal, never supplied by the
   *  caller** (ADR-008).
   *
   *  `null` in v1: TGR has no `DatosCntrNow` equivalent and where the RUT actually comes from is
   *  still open (id_token claim? an `api.tgr.cl` call?). Typed nullable rather than faked, so a
   *  consumer cannot mistake "not yet resolved" for "resolved to something". Resolved by the
   *  first `tgr auth login --observe`. */
  readonly rut: string | null;
  /** Razón social as TGR renders it. PII — local only (`0600` + Windows ACL), never audited,
   *  never sent anywhere. Null when the hand-off link did not carry it. */
  readonly razonSocial?: string | null;
  /** Which IdP authenticated this session (`ClaveTributaria` | `ClaveUnica` | `ClaveTesoreria`).
   *  Diagnostic: it is the difference between a lockout that is shared with the `sii` tool and one
   *  that is not (ADR-004). */
  readonly idp?: string | null;
  /** Persisted storage state — cookies-only for now (ADR-005). Opaque to the core. */
  readonly cookies: unknown;
  readonly savedAt: string;
}

export async function readSession(store: KeyValueStore): Promise<StoredSession | null> {
  return store.read<StoredSession>(SESSION_KEY);
}

export async function writeSession(store: KeyValueStore, session: StoredSession): Promise<void> {
  await store.write(SESSION_KEY, session);
}

export async function deleteSession(store: KeyValueStore): Promise<void> {
  await store.delete(SESSION_KEY);
}

/** Acquire a live `PortalSession` from the stored jar and run `fn` against it. This is how DOMAIN
 *  TASKS reach TGR: they CONSUME a session, they never mint one — only `login` mints (ADR-002).
 *  The session is always closed.
 *
 *  There is still NO local staleness/TTL gate: the lifetime is measured only from below so far
 *  (live at ~59 min, dead by ~157 min — docs/tgr-contract/auth-login.md), and ADR-005 refuses to
 *  invent a constant. TGR remains the authority: the facade's own landing check is the liveness
 *  test, and an expired jar surfaces as `NotAuthenticated`. */
export async function withSession<T>(
  runtime: Runtime,
  fn: (session: PortalSession) => Promise<T>,
): Promise<T> {
  const stored = await readSession(runtime.store);
  if (!stored) {
    throw new NotAuthenticatedError('No hay sesión. Ejecuta `tgr auth login`.');
  }
  let session: PortalSession | null = null;
  try {
    session = await runtime.portal.restore(stored.cookies);
    return await fn(session);
  } finally {
    await session?.close();
  }
}
