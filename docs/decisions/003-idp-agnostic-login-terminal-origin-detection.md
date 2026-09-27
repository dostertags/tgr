# ADR-003: IdP-agnostic interactive login; success = terminal app origin

## Status

Accepted — 2026-08-10.

## Context

Observed 2026-08-10 by read-only GET of TGR's public login surface (no
credentials submitted, no account touched):

TGR authenticates via **OAuth2 authorization-code over AWS Cognito**. The entry
point `https://www.tesoreria.cl/LoginPortalCognito/login?go=…&sp=…` redirects to
`https://autentica.tgr.cl/oauth2/authorize-front?client_id=…&redirect_uri=https://www.tesoreria.cl/LoginPortalCognito/&response_type=code&providers=ClaveTesoreria,ClaveTributaria,ClaveUnica`,
which renders a picker of **three federated IdPs**:

| IdP              | Lands on                                | Then                                                     |
| ---------------- | --------------------------------------- | -------------------------------------------------------- |
| Clave TGR        | `autentica.tgr.cl/idp/oauth2/authorize` | → `id-auth.tgr.cl/oauth2/idpresponse`                    |
| Clave Tributaria | `www2.sii.cl/oauthsii-v1-org/`          | → `api.tgr.cl/clave-tributaria-v2/v1/oauth2/idpresponse` |
| ClaveÚnica       | `accounts.claveunica.gob.cl`            | → `id-auth.tgr.cl/oauth2/idpresponse`                    |

The `sii` success rule — _"hostname ≠ the login host ⇒ authenticated"_ — is
therefore **actively wrong** here: `www2.sii.cl` and `accounts.claveunica.gob.cl`
are legitimate mid-flow waypoints, and treating either as success would mint a
session from an unauthenticated page.

## Decision

- **The default login is interactive and IdP-agnostic.** The driver opens a headed
  Chromium at TGR's own login entry and waits. The **user** picks the IdP and types
  the credential into the IdP's real page. The tool never chooses, never sees, and
  never stores it.
- **Success is detected by arriving at a terminal APP origin** — an allowlist
  (`www.tesoreria.cl`, `tgr.gob.cl`) — not by leaving an auth origin. An allowlist
  of terminal origins is chosen over a denylist of waypoints because a new or
  changed IdP must fail closed, not open.
- **`page.goto()` resolves after redirects settle**, so control returns while
  already on `autentica.tgr.cl`. A single `waitForURL(hostname ∈ APP_HOSTS)` is
  therefore unambiguous and cannot match the pre-redirect entry URL. The driver
  asserts this precondition explicitly rather than relying on it silently.
- **The login destination is a closed union** (`config/config.ts` `DESTINATIONS`),
  not caller-supplied. Unlike SII's unkeyed query, TGR's `go`/`sp` parameters are
  keyed and encodable — but keeping the union closed preserves the property that no
  caller input reaches a login URL.
- **Timeout budget: 300 s** (vs. `sii`'s 180 s). The flow has more hops, the user
  must choose an IdP, and an email challenge may appear.

## Alternatives Considered

1. **Commit to one IdP and drive it directly.** Rejected for the interactive path
   — it removes user choice for no gain, and hard-codes a redirect chain that TGR
   controls. (The _headless_ path must pick one; that is ADR-004.)
2. **Hand-build the Cognito `authorize` URL with the observed `client_id`.**
   Rejected — the same reasoning `sii` used to refuse hand-building a login POST:
   navigate the app's own entry point and let it own the parameters.
3. **Denylist the auth origins; anything else is success.** Rejected — fails open
   when TGR adds an IdP.

## Consequences

- Easier: one login path serves all three IdPs; the credential stays entirely
  outside this process.
- Harder: success detection depends on an origin allowlist that must be revisited
  if TGR moves its app hosts. The allowlist lives in one place and is asserted in
  tests.
- Open until first live login: the exact terminal URL and whether an email
  challenge interrupts the flow. Recorded in `docs/tgr-contract/auth-login.md`.

## Amendment — 2026-08-10 (first live login)

The decision stands; **the detection rule in it was wrong and is replaced.**

"Landed on a terminal APP origin" is NOT a sufficient authentication signal. Two
false positives showed up within minutes of the first real login:

1. TGR serves **"TGR - Sesión expirada"** at `/LoginPortalCognito/login` — an APP
   origin. A dead session was reported as `already_authenticated`, and a failed
   login could have minted a session. Fail-OPEN, in the one place this ADR set out
   to fail closed.
2. `tgr.gob.cl` is a **public CMS**. Both the IdP picker and the error page carry an
   "Ir a tgr.cl" link, so a wandering browser satisfies an origin-only check with no
   session at all.

There is also no "arrived at the destination" signal to wait for, because **TGR's
post-auth redirect is broken**: it resolves the destination to the literal string
`null`, requests `/LoginPortalCognito/null`, and 404s. That 404 IS the terminus of a
successful login. An intermediate fix that required reaching the real `sp` target
made login impossible — the flow can never satisfy it.

**Replacement rule** (`config.ts`):

- `isAuthenticatedLanding(url)` — an APP origin at a path OTHER than the login entry
  path. Accepts `…/null`; rejects the expired page; forward-compatible if TGR ever
  fixes the redirect.
- `hasCompletedExchange(cookieNames)` — a second, independent post-condition on a
  FRESH login: the `userCognito` cookie on `www.tesoreria.cl`, which only a completed
  Cognito exchange sets. Closes the public-CMS hole. Not a liveness test — it
  outlives the session.
- **`APP_HOSTS` gains `web.tesoreria.cl`**, the authenticated site. Nothing on the
  public site links to it; it surfaced only by restoring a live session into a headed
  browser.
- Liveness is probed against `SESSION_PROBE_URL`, never the login entry — see ADR-005's
  outcome note and the wire contract.

Consequence: detection is now origin **and** path, plus a cookie post-condition. More
moving parts than promised, and it depends on TGR keeping its expired page at the entry
path. Both are recorded in `docs/tgr-contract/auth-login.md` so a future change is
diagnosable rather than mysterious.
