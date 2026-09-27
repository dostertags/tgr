// TGR production hostnames — the single source of truth (ADR-002). Never hard-code a TGR host
// anywhere else. Prod is the only target; there is no env switch.
//
// Every value here is first-hand observation of the live TGR surface on 2026-08-10, by read-only
// GET with no credentials submitted. See docs/tgr-contract/auth-login.md.

export const HOSTS = {
  /** Public site (post-2026 domain). Also an APP host once authenticated. */
  portal: 'https://tgr.gob.cl',
  /** The authenticated web app + the OAuth redirect target. */
  app: 'https://www.tesoreria.cl',
  /** The app's own login entry. Navigating here 302s to the Cognito authorize front, which is why
   *  we never hand-build the authorize URL: TGR owns its client_id and provider list. */
  loginEntryPath: '/LoginPortalCognito/login',
  /** Cognito authorize front — renders the three-IdP picker. An AUTH origin, never a success. */
  auth: 'https://autentica.tgr.cl',
  /** Clave TGR's own IdP form (`#rut` / `#password` / `#iniciarSesion`). The ADR-004 headless
   *  target. Reached from the picker; recorded here for the v1.1 credential path. */
  claveTgrIdpPath: '/idp/oauth2/authorize',
} as const;

/** Terminal APP origins. Landing on one of these means the OAuth round-trip completed
 *  (ADR-003). This is an ALLOWLIST on purpose: a new or renamed IdP must fail CLOSED. */
export const APP_HOSTS: ReadonlySet<string> = new Set([
  'www.tesoreria.cl',
  'tgr.gob.cl',
  /** The AUTHENTICATED site. Discovered 2026-08-10 only by restoring a real session into a headed
   *  browser: `tgr.gob.cl/tramites-tgr/…` redirects HERE once you hold a session, and this is
   *  where the trámite pages actually render. Nothing on the public site links to it. */
  'web.tesoreria.cl',
]);

/** A PROTECTED page, used purely as a liveness probe.
 *
 *  Verified 2026-08-10 in both arms: with a live session it redirects to
 *  `web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/` and renders the authenticated view; with no
 *  session it bounces out to `autentica.tgr.cl`. That discrimination is the whole point.
 *
 *  Do NOT probe liveness with the login entry: re-entering the login flow while already holding a
 *  session renders "TGR - Sesión expirada" regardless of whether the session is good, which reads
 *  as a dead session and is simply wrong. */
export const SESSION_PROBE_URL = 'https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/';

/** Measured server-side session lifetime: live at 58.4 min, dead at 68.2 min (2026-08-12,
 *  docs/tgr-contract/auth-login.md). Used ONLY to word a hint — deliberately not a local gate. */
export const SESSION_TYPICAL_LIFETIME_MINUTES = 60;

/** Trámite pages on the authenticated site. Each is a WordPress shell that embeds the real Java
 *  application in an iframe via a freshly-minted `vr` hand-off (ADR-011). We navigate to the SHELL
 *  and let the iframe render — we never build the inner URL ourselves. */
export const TRAMITES = {
  /** "Cupón de Pago de Impuestos Fiscales y Aduaneros" — the shell around `ImpuestosFiscalesWEB`,
   *  which holds the fiscal AND aduanero (DIN-derived) debt listing. */
  deudasFiscales: 'https://web.tesoreria.cl/tramites-tgr/pago-impuestos-fiscales/',
  /** "Mi Cartola Fiscal" — the 12-month situación dashboard (deudas by type, pagos, cobranza,
   *  convenios). Its app is the one that requires the bootstrap; see `portal/tramite.ts`. */
  cartolaFiscal: 'https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/',
} as const;

/** URL fragments identifying the embedded app inside a trámite shell. Used to select the right
 *  frame — never to construct a URL. */
export const EMBEDDED_APPS = {
  impuestosFiscales: 'ImpuestosFiscalesWEB',
  cartolaFiscal: 'CartolaFiscalInterWeb',
} as const;

/** THE ONLY form value this tool ever submits to TGR (ADR-011).
 *
 *  `ImpuestosFiscalesWEB` will not show a debt listing until `tipoPago` is chosen. This is the
 *  NON-payment branch ("Imprimir comprobante de pago"); the payment branch is listed in
 *  `payment-denylist.ts` as a forbidden value and is absent from the rest of the tree, enforced by
 *  `no-payment.test.ts`. Selecting a mode in order to reach a consulta screen is not generating a
 *  cupón and moves no money — see ADR-011 for the full reasoning and the exact wording of the
 *  read-only promise. Observed 2026-08-11. */
export const TIPO_PAGO_COMPROBANTE = 'PortalFiscalPresencial';

/** Path fragment of the hand-off link that carries the principal's identity out of the
 *  authenticated cartola page and into the cartola application (ADR-010). Matched as a fragment
 *  rather than a full URL because the link is built by TGR and its host/query vary. */
export const RUT_HANDOFF_PATH = 'LoginPortalPagosTGR12Web/redirect';

/** A realistic desktop Chrome UA for HEADLESS contexts.
 *
 *  Not evasion of a bot check — TGR itself imposes none. The CDN in front of `tgr.gob.cl` answers
 *  Playwright's default `HeadlessChrome` UA with an S3 `AccessDenied` XML error instead of the
 *  page (observed 2026-08-10: identical failure with and without cookies, while the same URL in a
 *  headed browser rendered fine). Without this, every headless read is a false negative. */
export const HEADLESS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

/** Mid-flow AUTH origins. Legitimate waypoints, never a success signal. Kept for diagnostics and
 *  for the driver's precondition assertion — NOT used to decide authentication (ADR-003: an
 *  allowlist of terminal origins decides that, not a denylist of waypoints).
 *
 *  Note `www2.sii.cl`: TGR federates to SII's OAuth provider, which is a DIFFERENT surface from
 *  the `zeusr.sii.cl` login form the companion `sii` tool automates. */
export const AUTH_HOSTS: ReadonlySet<string> = new Set([
  'autentica.tgr.cl',
  'www2.sii.cl',
  'accounts.claveunica.gob.cl',
  'api.tgr.cl',
  'id-auth.tgr.cl',
]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Did we land on a terminal app origin? THE authentication signal (ADR-003). */
export function isAppHost(url: string): boolean {
  const h = hostnameOf(url);
  return h !== null && APP_HOSTS.has(h);
}

/** Are we still inside the federated auth flow? Diagnostic only — never a success test. */
export function isAuthHost(url: string): boolean {
  const h = hostnameOf(url);
  return h !== null && AUTH_HOSTS.has(h);
}

/** THE authentication signal (ADR-003 as amended 2026-08-10).
 *
 *  There is NO "arrived at the destination" signal to wait for, because **TGR's post-auth
 *  redirect is broken**: after a successful login their app resolves the destination to the
 *  literal string `null` and navigates to `/LoginPortalCognito/null`, which returns a WebLogic
 *  404. That 404 IS the terminus of a successful login (observed 2026-08-10, twice).
 *
 *  What makes this decidable is that TGR serves "TGR - Sesión expirada" at
 *  `/LoginPortalCognito/login` — the SAME path as the login entry we navigate to. So the three
 *  observed states separate by origin + path alone, with no content sniffing:
 *
 *    · redirected out to an AUTH origin (IdP picker)      → no session
 *    · APP origin at the entry path (`…/login`)           → session dead / not yet authenticated
 *    · APP origin at any other path (`…/null`, or a real
 *      destination if TGR ever fixes the redirect)        → authenticated
 *
 *  Known hole, accepted for v1 and mitigated in the login path by `hasCompletedExchange`:
 *  `tgr.gob.cl` is a public CMS, so a browser that wanders there (both the IdP picker and the
 *  expired page carry an "Ir a tgr.cl" link) would satisfy this predicate without a session. */
export function isAuthenticatedLanding(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!APP_HOSTS.has(u.hostname)) return false;
  return u.pathname !== HOSTS.loginEntryPath;
}

/** Cookie TGR's portal sets only once the Cognito code exchange has completed (observed
 *  2026-08-10 on `www.tesoreria.cl`).
 *
 *  Presence proves an exchange HAPPENED — it does NOT prove the session is still live: it was
 *  still in the jar when the portal answered "Sesión expirada". So it is used as a post-condition
 *  on a FRESH login (where the context started empty, making its appearance meaningful), and
 *  never as a liveness test. */
export const EXCHANGE_COOKIE = { name: 'userCognito', domain: 'www.tesoreria.cl' } as const;

/** Did the Cognito exchange actually run in this context? Closes the `tgr.gob.cl` hole above for
 *  the fresh-login path: a browser that merely wandered onto the public CMS never acquires this
 *  cookie. Takes the cookie-NAME map from `SessionAnatomy` — names only, no values (ADR-009). */
export function hasCompletedExchange(
  cookieNamesByDomain: Readonly<Record<string, readonly string[]>>,
): boolean {
  return (cookieNamesByDomain[EXCHANGE_COOKIE.domain] ?? []).includes(EXCHANGE_COOKIE.name);
}

/** Post-login destinations we ever send. A CLOSED union rather than `string`: TGR's `go`/`sp`
 *  parameters ARE keyed and encodable (unlike SII's unkeyed query), so this is not forced by the
 *  URL format — it is kept closed so no caller-supplied value can ever reach a login URL. */
export const DESTINATIONS = {
  /** "Mi Cartola Fiscal" — the destination TGR's own homepage link uses (observed 2026-08-10).
   *  v1 has no read surfaces; this is simply a valid landing target for the login round-trip. */
  cartolaFiscal: { go: 'cf12_w12', sp: '/tramites-tgr/mi-cartola-fiscal/' },
} as const;

export type LoginDestination = (typeof DESTINATIONS)[keyof typeof DESTINATIONS];

/** Build the login entry URL. `sp` is percent-encoded (observed format); `go` is sent plain. */
export function loginUrl(destination: LoginDestination): string {
  const sp = encodeURIComponent(destination.sp);
  return `${HOSTS.app}${HOSTS.loginEntryPath}?go=${destination.go}&sp=${sp}`;
}

export interface Settings {
  /** Max requests/second used to pace portal requests (CONVENTIONS). */
  readonly rateLimitRps: number;
  /** Headed-login budget. 300 s, vs. the companion tool's 180 s: TGR's flow has more hops, the
   *  user must first CHOOSE an IdP, and an email challenge may appear (ADR-003). */
  readonly loginTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  rateLimitRps: 1,
  loginTimeoutMs: 300_000,
};

// NOTE — deliberately absent: a session TTL constant. The companion tool's 12 h figure came from
// measurement; TGR's lifetime is unknown and inventing a number would be a guess wearing a
// constant's clothes (ADR-005). It lands here once observed.
