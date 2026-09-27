# Wire contract — auth login (TGR, OAuth2 / Cognito)

Observed **2026-08-10** against the live TGR portal (production — the only target). First-hand
observation, no third-party library.

All concrete values are **redacted / synthetic**. Real RUT, razón social, email, cookie values and
token contents are PII and MUST NOT land here.

Surface: `@dostertags/tgr-core` `auth.login` (`packages/core/src/auth/auth.ts`) over the
Playwright `PortalDriver` (`packages/core/src/adapters/node/portal.ts`). CLI:
`tgr auth login [--observe]`, `tgr auth status`, `tgr auth logout`.

## Flow

1. **Open the login entry (headed).** We navigate TGR's own entry URL rather than hand-building
   the Cognito authorize URL, so TGR keeps ownership of its `client_id` and provider list:

   ```
   https://www.tesoreria.cl/LoginPortalCognito/login?go=cf12_w12&sp=%2Ftramites-tgr%2Fmi-cartola-fiscal%2F
   ```

   This is the single entry point used site-wide (identical on the homepage and on
   `/oficina-virtual-tgr/`). `page.goto` resolves after the redirect chain settles, so control
   returns while already on the IdP picker — asserted explicitly by the driver.

2. **302 → the Cognito authorize front**, which renders a three-IdP picker:

   ```
   https://autentica.tgr.cl/oauth2/authorize-front
     ?client_id=<REDACTED>&redirect_uri=https%3A%2F%2Fwww.tesoreria.cl%2FLoginPortalCognito%2F
     &response_type=code&providers=ClaveTesoreria,ClaveTributaria,ClaveUnica&sesion=true
   ```

3. **The user picks an IdP and authenticates on the IdP's own page.** The credential never enters
   this process (ADR-003).

4. **⚠️ TGR's post-auth redirect is BROKEN.** After a successful login their app resolves the
   destination to the literal string `null` and navigates to:

   ```
   https://www.tesoreria.cl/LoginPortalCognito/null   →  WebLogic "Error 404--Not Found"
   ```

   **This 404 is the terminus of a successful login.** Observed twice, with the `go`/`sp` pair
   that TGR's own site links. There is no onward redirect to wait for; a predicate that requires
   reaching the `sp` target makes login impossible (that mistake cost a full timeout cycle).

5. **Persist cookies-only** — `{ rut, cookies, savedAt }` in `~/.tgr/session.json`, mode `0600`
   plus a restrictive ACL on Windows. **Confirmed sufficient** (see ADR-005 below).

6. **Logout** wipes local state only. No server-side logout endpoint has been identified.

## Detecting success (ADR-003, as amended)

The three states separate by **origin + path**, with no content sniffing:

| Landing                                                     | Meaning                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------- |
| an AUTH origin (`autentica.tgr.cl`, …)                      | not authenticated                                               |
| an APP origin at the entry path `/LoginPortalCognito/login` | **not** authenticated — TGR serves `TGR - Sesión expirada` here |
| an APP origin at any other path (`…/null`, or a real page)  | authenticated                                                   |

Plus a second, independent post-condition on a fresh login: the **`userCognito`** cookie on
`www.tesoreria.cl`, which only a completed Cognito exchange sets. This closes the hole that
`tgr.gob.cl` is a public CMS which both the IdP picker and the error page link to ("Ir a tgr.cl").

### ⚠️ Do NOT probe liveness with the login entry

Re-entering the login flow while already holding a session renders **"TGR - Sesión expirada"
regardless of whether the session is good**. A liveness probe built on that URL reports every live
session as dead — observed 2026-08-10, 26 seconds after a successful login.

Probe `SESSION_PROBE_URL` instead: `https://tgr.gob.cl/tramites-tgr/mi-cartola-fiscal/`.
With a session it redirects to the authenticated site and renders; without one it bounces to
`autentica.tgr.cl`.

## Origins

| Role                             | Hosts                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| AUTH (mid-flow waypoints)        | `autentica.tgr.cl`, `www2.sii.cl`, `accounts.claveunica.gob.cl`, `api.tgr.cl`, `id-auth.tgr.cl` |
| APP (terminal)                   | `www.tesoreria.cl`, `tgr.gob.cl`, **`web.tesoreria.cl`**                                        |
| ⛔ PAYMENT (denylisted, ADR-006) | `centro-pagos.tgr.cl`, `contribuciones.tgr.cl`                                                  |

**`web.tesoreria.cl` is the AUTHENTICATED site** — where trámite pages actually render. Nothing on
the public site links to it; it was found only by restoring a live session into a headed browser.
`tgr.gob.cl/tramites-tgr/<x>/` redirects there once authenticated.

Three registrable domains: `tgr.cl`, `tgr.gob.cl`, `tesoreria.cl`.

## ⚠️ Headless is served differently

The CDN in front of `tgr.gob.cl` answers Playwright's default `HeadlessChrome` user agent with an
S3 `AccessDenied` XML error instead of the page — **identically with and without cookies**, while
the same URL in a headed browser renders fine. Left unhandled, every headless read is a false
negative. `restore()` therefore sets `HEADLESS_USER_AGENT`. The login flow itself has no CAPTCHA
on the TGR side.

⚠️ **Correction (observed 2026-09-26):** the claim that "TGR imposes no bot check" no longer holds
for every surface. The cartola application's `begin` page is a **reCAPTCHA interstitial** (see
`cartola-fiscal.md`). This tool never interacts with that challenge — it neither clicks nor solves
anything; it only waits for the page to forward itself — but a headless browser presenting a
regular Chrome user agent to a page that scores bots is a posture that needs its own ADR. Until
then `tgr cartola` is **experimental**.

## IdP forms (read-only GET; no credentials submitted)

### Clave TGR — `autentica.tgr.cl/idp/oauth2/authorize`

Server-rendered. **No reCAPTCHA, no challenge step, no rotation block.** The ADR-004 headless
target. → `https://id-auth.tgr.cl/oauth2/idpresponse`

| element | id               | name                                                    |
| ------- | ---------------- | ------------------------------------------------------- |
| RUT     | `#rut`           | `rut`                                                   |
| Clave   | `#password`      | `password`                                              |
| submit  | `#iniciarSesion` | —                                                       |
| hidden  | —                | `redirect_uri`, `state`, `client_id`, `rut`, `password` |

### Clave Tributaria — `www2.sii.cl/oauthsii-v1-org/`

→ `https://api.tgr.cl/clave-tributaria-v2/v1/oauth2/idpresponse`. **Not** the page the companion
`sii` tool automates (`zeusr.sii.cl/AUT2000/…`) — different host, different selectors, no `<form>`
element. Its lockout counter is shared with SII (ADR-004).

| element   | id                                                       | notes                                                                  |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| RUT       | `#inputRut` (name `rut`)                                 | placeholder `Ej: 12345678-9` — **with** dash                           |
| Clave     | `#inputPass`                                             |                                                                        |
| submit    | `#bt_ingresar`                                           |                                                                        |
| challenge | `#correo`, `#btn-verify-challenge`, `#btn-no-autorizado` | email-verification scaffold — **not triggered** in the observed logins |
| rotation  | `#MCurrentPass2`, `#MNewPass2`, `#btn-actualizar-ct`     | forced password change                                                 |

### ClaveÚnica — `accounts.claveunica.gob.cl`

OIDC, scope `openid run name`. → `https://id-auth.tgr.cl/oauth2/idpresponse`.
**Never automated (ADR-004):** carries `#grctoken` (reCAPTCHA) and `password-encoded`.

## Identity of the principal (ADR-010)

There is no `DatosCntrNow` equivalent, and the login terminus (the `/null` 404) carries nothing.
The identity lives on the **authenticated** cartola page, in the hand-off link into the cartola
application:

```
https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/
  ?go=https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=<BASE64>
  &no=<razon+social>
  &ap=
```

`vr` base64-decodes to six comma-separated fields (shape real, values redacted):

| #   | Field                                                           | Read?                           |
| --- | --------------------------------------------------------------- | ------------------------------- |
| 0   | 32-char opaque token                                            | no                              |
| 1   | ISO timestamp (hand-off is time-bound)                          | no                              |
| 2   | RUT body                                                        | **yes**                         |
| 3   | 32-char signature                                               | no                              |
| 4   | `/CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=<body>&DV=<dv>` | **yes** (DV + body cross-check) |
| 5   | IdP name (`ClaveTributaria` / `ClaveUnica` / `ClaveTesoreria`)  | **yes**                         |

Plus `no=` on the outer link → razón social.

The opaque token and signature are **never read, stored, or logged**: this project takes the
identity, not the capability. The RUT body appears twice and must agree, and the assembled
`<body>-<DV>` must pass Mod-11 — any mismatch yields `null` rather than a wrong RUT.

**The cartola APPLICATION itself** lives at `www.tesoreria.cl/CartolaFiscalInterWeb/` and is
reached only through that signed, time-bound `vr` hand-off. Reading it is a separate surface and
needs its own ADR — do not construct that URL by hand.

## ⚠️ Navigation must wait for client-side redirects

`tgr.gob.cl/tramites-tgr/<x>/` redirects **client-side**. A `goto` that resolves on
`domcontentloaded` returns the PRE-redirect URL — which passes the landing predicate — for a
browser that is about to be bounced to the IdP picker. That made the warm-session check report
true unconditionally (observed 2026-08-10). `PortalSession.goto` therefore waits for
`networkidle` (bounded, best-effort) before reporting the landed URL.

## Session anatomy (observed; NAMES only)

| Domain                          | Cookie names                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `www.tesoreria.cl`              | `JSESSIONID`, `userCognito`, `go`, `provider`, `sp`, `TS…` (F5), `x-apm-brtm-*`     |
| `.id-auth.tgr.cl`               | `cognito`                                                                           |
| `autentica.tgr.cl`              | `providerTGR_backup`, `providerTGRExp_backup`                                       |
| `.tgr.cl` / `.autentica.tgr.cl` | analytics only (`_ga*`, `_gid`, `_hj*`)                                             |
| `.sii.cl` / `www2.sii.cl`       | `dtCookie` (Dynatrace), `TS…` (F5) — present when the Clave Tributaria IdP was used |
| `.nr-data.net`                  | `JSESSIONID` (New Relic)                                                            |

`localStorage`, by origin:

| Origin                     | localStorage keys                                 | sessionStorage |
| -------------------------- | ------------------------------------------------- | -------------- |
| `https://autentica.tgr.cl` | `autenticaState`, `providerTGR`, `providerTGRExp` | —              |
| `https://www.tesoreria.cl` | **(empty)**                                       | (empty)        |

**No Cognito tokens in `localStorage` anywhere.** `LoginPortalCognito` is a **server-side** code
exchange (WebLogic + `JSESSIONID`), not a browser-side one — which is why cookies-only works.

## ADR-005: RESOLVED — cookies-only is sufficient

Verified 2026-08-10 end to end: a `{ cookies }`-only jar, restored into a fresh headless context,
reaches the authenticated cartola on `web.tesoreria.cl` and renders the empresa's own view.
`tgr auth login` reports `already_authenticated` without opening a browser.

**No escalation to a storage-key allowlist is needed.** The `autenticaState` / `providerTGR` keys
on `autentica.tgr.cl` are login-flow state, not session material, and are correctly dropped.

## Still open

- [x] **Session lifetime — MEASURED 2026-08-12: about ONE HOUR.** Bracketed against
      `SESSION_PROBE_URL` within a single session: **live at 58.4 min, dead at 68.2 min**. An
      earlier session was live at 33 min and ~59 min, and dead at 157 min — all consistent with a
      60-minute server-side lifetime (a common WebLogic/Cognito default).

  **No local TTL gate is enforced, deliberately.** The costs are asymmetric: a false "expired"
  forces the user through an interactive browser login, while a doomed round-trip costs a few
  seconds. With a single bracket, a 60-minute gate would cut a live session short whenever the real
  value sits above it. TGR stays the authority; the landing check is the liveness test. What the
  measurement IS used for is the error message — `openTramite` now says the session expired and
  that sessions last about an hour, instead of blaming the scraper.

- [x] **Principal RUT (ADR-008).** RESOLVED — read from the cartola hand-off link (ADR-010),
      together with razón social and the authenticating IdP.
- [ ] **The cartola data itself.** `www.tesoreria.cl/CartolaFiscalInterWeb/`, reached only via the
      signed `vr` hand-off. Needs its own ADR before any code.
- [ ] **Server-side logout endpoint.** None identified; `logout` wipes local state only.
- [ ] Whether the Clave Tributaria email challenge ever fires (scaffold present, never triggered).
