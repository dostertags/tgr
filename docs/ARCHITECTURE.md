# Architecture

Ports & adapters, ported from `sii` (ADR-002). One domain core; surfaces are thin.

```text
        ┌──────────────────────────────────────────┐
        │  packages/cli   @…/tgr-cli  (commander)   │   ← v1 surface
        └────────────────────┬─────────────────────┘
                             │ calls TASKS ONLY
        ┌────────────────────▼─────────────────────┐
        │  packages/core  @…/tgr-core               │
        │                                          │
        │  tasks/     use-case orchestration        │
        │  auth/      login · session · logout      │
        │  observe/   session-anatomy rendering     │
        │  portal/    TGR facades (none yet in v1)  │
        │  config/    hosts · destinations · denylist│
        │  rut/ errors/ audit/ format/              │
        │                                          │
        │  seams/     ← INTERFACES (the boundary)   │
        └────────────────────┬─────────────────────┘
                             │
        ┌────────────────────▼─────────────────────┐
        │  adapters/node   Playwright · fs · icacls │
        │  adapters/fake   in-memory, for tests     │
        └──────────────────────────────────────────┘
```

## The rules

1. **Surfaces call tasks only.** The CLI never imports a portal facade, a session
   primitive, or Playwright. Reaching past the task layer bypasses pacing, the
   audit receipt, and credential handling.
2. **The core never imports `playwright`, `node:fs`, or a keyring.** It reaches
   them exclusively through `seams/index.ts` interfaces. Exactly one module —
   `adapters/node/portal.ts` — imports Playwright, and it does so lazily.
3. **Only `login` mints a session.** Domain tasks consume one via `withSession`
   or raise `NotAuthenticated`; they never mint as a side-effect.
4. **The composition root is `node.ts`** (`@…/tgr-core/node`), kept off the main
   barrel so importing the library never evaluates `node:*` or Playwright.
5. **No payment path exists.** See ADR-006 — this is enforced by a test, not a
   convention.

## Auth flow (ADR-003)

TGR is an OAuth2 authorization-code flow over AWS Cognito with three federated
IdPs. The flow traverses several origins, so success is detected by **arriving at
a terminal app origin**, never by "leaving the login host" (the `sii` rule, which
does not port).

```text
 www.tesoreria.cl/LoginPortalCognito/login?go=…&sp=…     ← we navigate here
        │  (302)
        ▼
 autentica.tgr.cl/oauth2/authorize-front                 ← AUTH origin: IdP picker
        │
        ├─ Clave TGR      → autentica.tgr.cl/idp/oauth2/authorize
        ├─ Clave Trib.    → www2.sii.cl/oauthsii-v1-org/  → api.tgr.cl/…/idpresponse
        └─ ClaveÚnica     → accounts.claveunica.gob.cl    → id-auth.tgr.cl/…/idpresponse
        │
        ▼
 www.tesoreria.cl (+ tgr.gob.cl)                          ← APP origin: authenticated
```

`page.goto()` resolves after redirects settle, so control returns while we are
already on an auth origin; a single `waitForURL(hostname ∈ APP_HOSTS)` is then
unambiguous. See `config/config.ts` and `adapters/node/portal.ts`.

## Session shape

`~/.tgr/session.json`, mode `0600` (POSIX) + restrictive ACL (Windows), holding
`{ rut, cookies, savedAt }` — the same shape as `sii` so that adding an `operate`
pointer later needs no migration. **Cookies-only** for now; whether that is
sufficient is the open question ADR-005 exists to resolve.
