// Opening a trámite shell and its embedded app (ADR-011).
//
// ⚠️ Some embedded apps refuse the FIRST hand-off in a cold context and render an access error;
// the same navigation repeated succeeds. Observed 2026-08-12 against `CartolaFiscalInterWeb`:
//
//   fresh context → cartola shell          → "Mi Cartola Fiscal - Usuario No Autorizado"
//   same context  → cartola shell (again)  → renders
//   fresh context → deudas shell, THEN cartola shell → cartola renders first time
//
// So the app needs a session established on `www.tesoreria.cl` before it will honour a hand-off.
// `ImpuestosFiscalesWEB` does not need it, which is why the deudas read worked without one.
//
// This is a BOOTSTRAP, not a retry. CONVENTIONS forbids retrying after TGR rejects something —
// that rule exists to avoid hammering a portal that has said no. Here TGR has not said no to a
// credential or an operation: the app is telling us its session is not up yet, and it accepts the
// very next navigation. It is performed at most ONCE, paced, and never in a loop.
import { isAuthenticatedLanding } from '../config/index.js';
import type { Clock, PortalSession } from '../seams/index.js';
import { NotAuthenticatedError, PortalReadError } from '../errors/index.js';
import { redactUrl } from '../observe/index.js';

/** The session check every read surface shares. Sessions last roughly an hour (measured live at
 *  58 min, dead at 68 min — docs/tgr-contract/auth-login.md), so hitting this is routine and the
 *  message must point at the fix rather than at a phantom scraper bug. */
function assertAuthenticated(landed: string): void {
  if (!isAuthenticatedLanding(landed)) {
    throw new NotAuthenticatedError(
      'La sesión expiró (duran alrededor de una hora). Ejecuta `tgr auth login`.',
    );
  }
}

/** The embedded apps announce a not-yet-bootstrapped session in the document title and body.
 *  Content sniffing is deliberate here and narrow: it detects an APP-level state, never
 *  authentication (which stays origin-based, ADR-003). */
const ACCESS_DENIED = `
  (() => {
    const t = (document.title || '');
    const b = ((document.body && document.body.innerText) || '');
    return /no autorizado/i.test(t) || /error de acceso/i.test(b);
  })()
`;

/** How long `readFrameWhenReady` keeps re-reading: ~10s in total. */
const RENDER_POLL_ATTEMPTS = 20;
const RENDER_POLL_INTERVAL_MS = 500;

/** Evaluate `expression` in the app frame until `isReady` accepts the result, or give up.
 *
 *  The frame is located by URL, which matches as soon as its navigation COMMITS — before the
 *  document has rendered. Scraping at that moment finds nothing (observed 2026-09-26: 1 of 7 live
 *  cartola reads failed that way). So wait for the DATA, not for a load state.
 *
 *  This re-reads the LOCAL DOM; no request leaves the browser, so it is not a retry in the
 *  CONVENTIONS sense. Bounded and paced through the Clock. A read that throws is "not rendered
 *  yet" (the frame's document is being replaced), except `PortalReadError` — a missing frame is a
 *  real structure change and propagates at once.
 *
 *  Returns the ready value, or the LAST value read (null if every read threw) so the caller can
 *  tell "never rendered" from "rendered something unexpected". */
export async function readFrameWhenReady<T>(
  session: PortalSession,
  clock: Clock,
  appMatch: string,
  expression: string,
  isReady: (value: T) => boolean,
): Promise<{ readonly ready: boolean; readonly value: T | null }> {
  let last: T | null = null;
  for (let attempt = 1; ; attempt++) {
    try {
      last = await session.evaluateInFrame<T>(appMatch, expression);
      if (isReady(last)) return { ready: true, value: last };
    } catch (err) {
      if (err instanceof PortalReadError) throw err;
    }
    if (attempt >= RENDER_POLL_ATTEMPTS) return { ready: false, value: last };
    await clock.sleep(RENDER_POLL_INTERVAL_MS);
  }
}

/** Navigate to a trámite shell and make sure its embedded app is actually usable.
 *
 *  Returns the landed URL **stripped of query and hash** so the caller can apply its own
 *  authentication check — this helper deliberately does not decide whether the session is valid.
 *
 *  The stripping is not cosmetic: once the shell's script runs, its own URL carries the signed
 *  `vr` hand-off in the query (observed 2026-08-12). Callers only ever need origin + path, so
 *  handing back the raw URL would put a live token into whatever logs or errors touch it. */
export async function openTramite(
  session: PortalSession,
  clock: Clock,
  shellUrl: string,
  appMatch: string,
): Promise<string> {
  let landed = await session.goto(shellUrl);

  // Check the LANDING before looking for the frame. An expired session is bounced to the IdP
  // picker, where there is no app iframe at all — and reporting that as "the trámite changed
  // structure" sends the user hunting for a scraper bug instead of running `tgr auth login`
  // (observed 2026-08-12, at a jar age of 68 minutes).
  assertAuthenticated(landed);

  const denied = await session.evaluateInFrame<boolean>(appMatch, ACCESS_DENIED);
  if (!denied) return redactUrl(landed);

  // Pace before the single bootstrap re-navigation (CONVENTIONS: ~1 rps).
  await clock.sleep(1000);
  landed = await session.goto(shellUrl);
  assertAuthenticated(landed);

  const stillDenied = await session.evaluateInFrame<boolean>(appMatch, ACCESS_DENIED);
  if (stillDenied) {
    throw new PortalReadError(
      `La aplicación embebida "${appMatch}" sigue negando el acceso tras el bootstrap. ` +
        'La sesión puede haber expirado, o la app cambió su control de acceso. ' +
        'No se reintenta más (CONVENTIONS).',
    );
  }
  return redactUrl(landed);
}
