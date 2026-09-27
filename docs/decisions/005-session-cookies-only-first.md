# ADR-005: Cookies-only session first; escalate to a key allowlist only if forced

## Status

Accepted — 2026-08-10. **Provisional**: the first live login may force the
escalation described below.

## Context

`sii` persists cookies only, explicitly dropping `localStorage`/origins before
writing `~/.sii/session.json`. That works because the SII session **is** a cookie.

TGR may not be. It is an AWS Cognito authorization-code flow: the redirect target
`www.tesoreria.cl/LoginPortalCognito/` receives `?code=…` and exchanges it. Where
the resulting tokens land is unknown without an actual login, and the two branches
have opposite consequences:

- **Server-side exchange** → a session cookie is set → cookies-only ports cleanly.
- **Browser-side exchange** (Amplify / Cognito JS SDK) → tokens land in
  `localStorage` under `CognitoIdentityServiceProvider.<clientId>.…` → a
  cookies-only jar restores a **logged-out** browser, silently.

Two further unknowns ride along: token lifetime (Cognito access tokens are
commonly ~1 h, against the ~12 h `sii` measured empirically) and whether refresh
happens from a refresh token held in `localStorage` — in which case a cookies-only
jar dies within the hour regardless of the first branch.

Structurally, TGR also spans **three registrable domains** (`tgr.cl`,
`tgr.gob.cl`, `tesoreria.cl`), so "the session" is a multi-domain cookie set, not
one SSO cookie.

## Decision

- **Persist cookies only**, for now — `storageState()` returns `{ cookies }` and
  nothing else, across all domains in the context.
- **`~/.tgr/session.json` holds `{ rut, cookies, savedAt }`**, mode `0600` on
  POSIX plus a restrictive ACL on Windows.
- **Resolve the unknowns empirically on the first login** via ADR-009's capture,
  and record the result in `docs/tgr-contract/auth-login.md`.
- **If cookies alone do not restore a session, escalate to an explicit allowlist
  of storage keys** — e.g. only the Cognito token keys for our `client_id` —
  **never a blanket dump of the origin's storage.**
- **No session TTL constant is asserted until measured.** `sii`'s 12 h figure came
  from observation; inventing a number here would be a guess wearing a constant's
  clothes.

## Alternatives Considered

1. **Persist full `storageState` (cookies + origins) from the start.** It cannot
   fail and needs no follow-up ADR. Rejected because the principle worth preserving
   from `sii` ADR-006 is not the literal word _cookies_ — it is _"persist the
   minimum that restores a session, and never the secret."_ A blanket dump quietly
   puts arbitrary page state on disk and forfeits the crisp "no bearer material
   beyond the session" claim. An allowlist keeps the principle true.
2. **Decide after logging in manually with DevTools.** Reasonable, but the decision
   is needed to write the driver at all; this ADR _is_ the pre-commitment, with the
   escalation path already agreed so the follow-up is mechanical.

## Consequences

- Easier: the security posture stays defensible and identical in spirit to `sii`.
- Harder: v1 may ship a login whose session does not survive `restore()`. That is
  acceptable **because v1 has no read surfaces** — nothing depends on restore yet,
  and diagnosing it is v1's actual deliverable.
- In **both** branches the clave never touches disk. That property is not at risk.

## Outcome — 2026-08-10: RESOLVED, cookies-only is sufficient

Verified end to end against the live portal. **No escalation to a storage-key
allowlist is needed**; this ADR leaves "provisional" status.

Evidence:

- `localStorage` on the app origin (`https://www.tesoreria.cl`) is **empty**, before
  and after restore. There are no Cognito tokens in browser storage anywhere.
- The only `localStorage` is on `autentica.tgr.cl` (`autenticaState`, `providerTGR`,
  `providerTGRExp`) — login-flow state, not session material, correctly dropped.
- `LoginPortalCognito` is a **server-side** code exchange (WebLogic, `JSESSIONID`),
  which is precisely the branch this ADR called the good one.
- A `{ cookies }`-only jar restored into a fresh headless context reaches the
  authenticated cartola on `web.tesoreria.cl` and renders the empresa's own view;
  `tgr auth login` then reports `already_authenticated` with no browser opened.

**Two traps cost most of the investigation, both recorded so they are not re-run:**

1. **The liveness probe was invalid.** It navigated the login entry, and re-entering
   the login flow while already authenticated renders "Sesión expirada" _regardless_
   of session state. A live session read as dead 26 seconds after minting. Probe
   `SESSION_PROBE_URL` (a protected page) instead.
2. **Headless is served differently.** The CDN in front of `tgr.gob.cl` answers
   Playwright's default `HeadlessChrome` UA with an S3 `AccessDenied` — identically
   with and without cookies — so every headless read was a false negative until
   `restore()` set a realistic UA.

**Still open:** the session LIFETIME is unmeasured. The earlier "expired after ~15–20
min" reading came from the invalid probe and must be re-measured against
`SESSION_PROBE_URL` before any TTL constant is written. The ADR's original refusal to
invent a number stands.
