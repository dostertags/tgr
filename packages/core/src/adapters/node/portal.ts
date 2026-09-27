// The Node default PortalDriver (ADR-002 / ADR-003): a Playwright/Chromium adapter. This is the
// ONLY module that imports Playwright — the core reaches the browser exclusively through the
// PortalSession / PortalDriver seams.
//
// Auth detection is ORIGIN-based and uses an ALLOWLIST of terminal app origins (ADR-003). The
// companion `sii` tool's rule — "hostname ≠ the login host ⇒ authenticated" — is actively WRONG
// here: TGR federates to `www2.sii.cl` and `accounts.claveunica.gob.cl`, which are legitimate
// mid-flow waypoints. The credential is typed by the user into the IdP's own page; it never
// crosses this boundary.
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  Frame,
  Page,
} from 'playwright';
import {
  HEADLESS_USER_AGENT,
  isAuthHost,
  isAuthenticatedLanding,
  isPaymentHost,
  loginUrl,
} from '../../config/index.js';
import {
  LoginFailedError,
  PaymentSurfaceBlockedError,
  PortalReadError,
  PortalTimeoutError,
} from '../../errors/index.js';
import { redactUrl } from '../../observe/index.js';
import type {
  InteractiveLoginOptions,
  PortalDriver,
  PortalSession,
  SessionAnatomy,
} from '../../seams/index.js';

/** How long a navigation waits for client-side redirects to settle before the URL is trusted.
 *  Bounded and best-effort — see the note in `goto`. */
const SETTLE_TIMEOUT_MS = 10_000;

/** Navigation budget. Playwright's 30s default is too tight: TGR's WordPress pages load their
 *  theme scripts serially, and DOMContentLoaded ranged 10–64s for the same URL within minutes
 *  (observed 2026-09-26). */
const NAV_TIMEOUT_MS = 90_000;

/** Map Playwright's `TimeoutError` onto `PortalTimeoutError`; pass everything else through.
 *
 *  A raw `page.goto: Timeout 30000ms exceeded.` reached the user on 2026-09-26. Matched by NAME
 *  so this module keeps importing Playwright lazily. The URL is redacted: a trámite shell's URL
 *  carries a signed `vr` hand-off once its script runs. Pure — unit tested without a browser. */
export function toPortalTimeout<E>(err: E, url: string): E | PortalTimeoutError {
  if (!(err instanceof Error) || err.name !== 'TimeoutError') return err;
  return new PortalTimeoutError(
    `TGR no respondió a tiempo (${redactUrl(url)}). El portal está lento o caído: ` +
      'vuelve a intentarlo en unos minutos. No se leyó nada.',
  );
}

/** How long to wait for a trámite shell's embedded app iframe to appear (ADR-011). */
const FRAME_TIMEOUT_MS = 20_000;

/** Lazy-load playwright — an OPTIONAL peer (ADR-002). Only the launch paths need it, so a
 *  consumer injecting its own PortalDriver never pays the module. A missing install fails HERE,
 *  at first actual use, with an actionable message — never at library import time. */
async function loadChromium(): Promise<BrowserType> {
  try {
    return (await import('playwright')).chromium;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const notFound = code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
    if (notFound && err instanceof Error && err.message.includes('playwright')) {
      throw new Error(
        'El PortalDriver por defecto necesita `playwright` (peer opcional). Instálalo: ' +
          '`pnpm add playwright` y luego `npx playwright install chromium`.',
      );
    }
    throw err;
  }
}

/** A session owns its browser; close() tears the whole instance down. */
class PlaywrightPortalSession implements PortalSession {
  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  async goto(url: string): Promise<string> {
    // ⛔ ADR-006 tripwire. The static guardrail test is the primary control; this catches the case
    // it cannot see — a URL assembled at runtime, or a redirect chain aimed at a payment page.
    if (isPaymentHost(url)) {
      throw new PaymentSurfaceBlockedError(
        `Navegación bloqueada: ${redactUrl(url)} es una superficie de PAGO de la TGR. ` +
          'Esta herramienta es de solo lectura por construcción (ADR-006).',
      );
    }
    await this.page
      .goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
      .catch((err: unknown) => {
        throw toPortalTimeout(err, url);
      });
    // TGR redirects CLIENT-SIDE. `domcontentloaded` resolves BEFORE that redirect runs, so
    // returning here would report `tgr.gob.cl/tramites-tgr/…` — which passes the landing
    // predicate — for a browser that is about to be bounced to the IdP picker. That made the
    // warm-session check report true unconditionally (observed 2026-08-10). Wait for the page to
    // go quiet, bounded, then read the URL. Best-effort: an analytics-heavy page may never reach
    // networkidle, and a timeout here must not fail the navigation.
    await this.page
      .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => undefined);
    return this.page.url();
  }

  async evaluate<T>(expression: string): Promise<T> {
    return (await this.page.evaluate(expression)) as T;
  }

  /** Locate the embedded app frame, or throw. Frames appear asynchronously (the shell renders,
   *  then the iframe loads), so this polls briefly rather than reading `page.frames()` once. */
  private async frameFor(frameMatch: string): Promise<Frame> {
    const deadline = Date.now() + FRAME_TIMEOUT_MS;
    for (;;) {
      const frame = this.page.frames().find((f) => f.url().includes(frameMatch));
      if (frame) return frame;
      if (Date.now() > deadline) {
        throw new PortalReadError(
          `No se encontró la aplicación embebida "${frameMatch}" en la página. ` +
            'La estructura del trámite cambió — no se leyó nada.',
        );
      }
      await this.page.waitForTimeout(250);
    }
  }

  async evaluateInFrame<T>(frameMatch: string, expression: string): Promise<T> {
    const frame = await this.frameFor(frameMatch);
    return (await frame.evaluate(expression)) as T;
  }

  async checkInFrame(frameMatch: string, selector: string): Promise<void> {
    const frame = await this.frameFor(frameMatch);
    await frame.check(selector).catch((err: unknown) => {
      throw toPortalTimeout(err, frame.url());
    });
  }

  async clickInFrame(frameMatch: string, selector: string): Promise<void> {
    const frame = await this.frameFor(frameMatch);
    const before = frame.url();
    await frame.click(selector).catch((err: unknown) => {
      throw toPortalTimeout(err, before);
    });

    // A submit in these apps replaces the frame's DOCUMENT, and the top-level page is already
    // idle, so waiting on the page alone returns instantly and the caller scrapes the OLD
    // document (observed 2026-08-12: the debt table read as absent). Wait for the frame itself to
    // turn over: a changed URL, then its load event.
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      const current = this.page.frames().find((f) => f.url().includes(frameMatch));
      if (current && current.url() !== before) {
        await current
          .waitForLoadState('load', { timeout: SETTLE_TIMEOUT_MS })
          .catch(() => undefined);
        break;
      }
      // Some submits re-render in place without changing the URL — don't hang for those.
      if (Date.now() > deadline) break;
      await this.page.waitForTimeout(200);
    }
    await this.page
      .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => undefined);
  }

  /** Capture the session's shape — NAMES ONLY (ADR-009). Cookie names come from the context's
   *  storage state (all domains at once); `localStorage` names likewise, per origin.
   *  `sessionStorage` is only reachable for the page's CURRENT origin, so every other origin
   *  reports an empty list — an absence of observation, not an observed absence. */
  async anatomy(): Promise<SessionAnatomy> {
    const state = await this.context.storageState();

    const cookieNamesByDomain: Record<string, string[]> = {};
    for (const c of state.cookies) {
      const bucket = (cookieNamesByDomain[c.domain] ??= []);
      bucket.push(c.name);
    }
    for (const domain of Object.keys(cookieNamesByDomain)) {
      cookieNamesByDomain[domain] = [...new Set(cookieNamesByDomain[domain] ?? [])].sort();
    }

    const storageKeyNamesByOrigin: Record<
      string,
      { localStorage: string[]; sessionStorage: string[] }
    > = {};
    for (const o of state.origins ?? []) {
      storageKeyNamesByOrigin[o.origin] = {
        localStorage: (o.localStorage ?? []).map((e) => e.name).sort(),
        sessionStorage: [],
      };
    }

    const landed = this.page.url();
    let currentOrigin: string | null = null;
    try {
      currentOrigin = new URL(landed).origin;
    } catch {
      currentOrigin = null; // about:blank and friends
    }
    if (currentOrigin !== null) {
      let sessionKeys: string[] = [];
      try {
        sessionKeys = ((await this.page.evaluate('Object.keys(sessionStorage)')) ?? []) as string[];
      } catch {
        // Some origins refuse storage access; an empty list is the honest answer.
      }
      const existing = storageKeyNamesByOrigin[currentOrigin];
      if (existing) existing.sessionStorage = [...sessionKeys].sort();
      else
        storageKeyNamesByOrigin[currentOrigin] = {
          localStorage: [],
          sessionStorage: [...sessionKeys].sort(),
        };
    }

    return {
      // Query + hash stripped: TGR's flow is OAuth authorization-code, so a raw terminal URL can
      // carry a live one-use `?code=`. It must not enter this object at all (ADR-009).
      landedUrl: redactUrl(landed),
      cookieNamesByDomain,
      storageKeyNamesByOrigin,
    };
  }

  async storageState(): Promise<unknown> {
    // Cookies-only (ADR-005): drop localStorage/origins before persisting, so no page-scoped data
    // lands on disk. If the first live login proves cookies alone cannot restore a session, the
    // escalation is an explicit ALLOWLIST of storage keys here — never a blanket dump.
    const state = await this.context.storageState();
    return { cookies: state.cookies };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export class PlaywrightPortalDriver implements PortalDriver {
  async interactiveLogin(options: InteractiveLoginOptions): Promise<PortalSession> {
    // HEADED: the user must see and use TGR's real IdP picker and the IdP's own form.
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: false });
    // Hoisted so the failure path can report WHERE the browser got stuck. Without it a timeout
    // discards the single most diagnostic fact available, and the next attempt is another guess.
    let page: Page | null = null;
    try {
      const context = await browser.newContext();
      page = await context.newPage();
      const entry = loginUrl(options.destination);
      await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

      // `goto` resolves only after the redirect chain settles, so control returns while we are
      // already on the Cognito IdP picker. ASSERT that rather than assume it (ADR-003): if the
      // entry ever stops redirecting, `waitForURL` below would match the entry URL itself and we
      // would mint a session from an unauthenticated page. Fail CLOSED instead.
      const afterEntry = page.url();
      if (!isAuthHost(afterEntry)) {
        throw new LoginFailedError(
          `La entrada de login no derivó a un origen de autenticación de la TGR ` +
            `(quedó en ${redactUrl(afterEntry)}). El flujo cambió: no se inició sesión. ` +
            'Revisa docs/tgr-contract/auth-login.md antes de reintentar.',
        );
      }

      // Success = arriving at an authenticated destination: an APP origin OUTSIDE the OAuth
      // exchange path (ADR-003 as amended). A bare origin check resolved too early here —
      // observed 2026-08-10 landing on `/LoginPortalCognito/null` while the exchange was still
      // running. Window close or timeout rejects; no partial session is ever written.
      await page.waitForURL((url) => isAuthenticatedLanding(url.toString()), {
        timeout: options.timeoutMs,
      });
      return new PlaywrightPortalSession(browser, context, page);
    } catch (err) {
      // Capture the last URL BEFORE tearing the browser down (query stripped — an OAuth landing
      // can carry a live `code`). This is what tells a human whether the flow never finished or
      // finished somewhere the landing predicate does not recognise.
      let lastUrl = '(desconocida)';
      try {
        if (page) lastUrl = redactUrl(page.url());
      } catch {
        // page already detached — keep the placeholder
      }
      // Close the whole browser on ANY failure so a launched instance never leaks.
      await browser.close();
      if (err instanceof LoginFailedError) throw err;
      throw new LoginFailedError(
        `Login no completado (tiempo agotado o ventana cerrada). Última URL vista: ${lastUrl}. ` +
          'Si esa URL parece un destino ya autenticado, el problema es el predicado de ' +
          'aterrizaje (config.ts isAuthenticatedLanding), no tu sesión. ' +
          'NO reintentes en bucle: los intentos fallidos bloquean la cuenta.',
      );
    }
  }

  async restore(storageState: unknown): Promise<PortalSession> {
    // HEADLESS: cookies-only readback for liveness. No UI.
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        storageState: storageState as NonNullable<BrowserContextOptions['storageState']>,
        // See HEADLESS_USER_AGENT: the CDN in front of tgr.gob.cl refuses Playwright's default
        // headless UA with an S3 AccessDenied, which would make every headless read look like a
        // dead session (observed 2026-08-10).
        userAgent: HEADLESS_USER_AGENT,
      });
      const page = await context.newPage();
      return new PlaywrightPortalSession(browser, context, page);
    } catch (err) {
      // Don't leak the launched browser; surface the original error (the login path treats a
      // failed restore as "not warm").
      await browser.close();
      throw err;
    }
  }
}
