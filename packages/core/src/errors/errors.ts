// Domain error hierarchy. The CLI maps these to exit codes (@dostertags/tgr-cli):
// NotAuthenticated → 2, LoginFailed → 3, RateLimit → 4, PaymentSurfaceBlocked → 5,
// PortalTimeout → 6, anything else → 1.
// Pass TGR's Spanish messages through unchanged (CONVENTIONS).

export class TgrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No local session; the user must run `tgr auth login`. */
export class NotAuthenticatedError extends TgrError {}

/** A local session existed but the portal rejected it. Subclass of NotAuthenticated so a
 *  generic catch still treats it as "not authenticated". */
export class SessionExpiredError extends NotAuthenticatedError {}

/** Login was not completed (timeout, window closed, or never left the auth origins).
 *  No partial session is ever written. */
export class LoginFailedError extends TgrError {}

/** TGR server-side rate limit / block. NEVER retry — surface verbatim and stop. */
export class RateLimitError extends TgrError {}

/** A stored credential was required (unattended re-mint) but none resolved. */
export class CredentialNotFoundError extends TgrError {}

/** Invalid user input: a malformed RUT, an unknown destination, etc. */
export class ValidationError extends TgrError {}

/** A read surface could not be read: the embedded app frame was absent, the expected control was
 *  missing, or the rendered table had unrecognised columns. "Scraper roto" — a LOUD failure by
 *  design (CONVENTIONS): never silently map an unexpected structure onto curated fields.
 *  NOT raised for an empty result — zero debts is a legitimate answer. */
export class PortalReadError extends TgrError {}

/** TGR did not answer within the navigation/interaction budget. Transient by nature — the portal
 *  is slow or down — so it is kept apart from `PortalReadError` (a broken scraper) and from
 *  `NotAuthenticatedError` (a slow page is no reason to log in again). Never retried here: the
 *  user decides when to try again. */
export class PortalTimeoutError extends TgrError {}

/** A navigation or request was aimed at a TGR PAYMENT surface (ADR-006). This should be
 *  unreachable — the static guardrail test is the primary control — so raising it means a
 *  redirect chain or a code change slipped past it. Fail loud, never continue. */
export class PaymentSurfaceBlockedError extends TgrError {}
