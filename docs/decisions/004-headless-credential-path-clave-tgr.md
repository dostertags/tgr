# ADR-004: The headless credential path targets Clave TGR, never ClaveÚnica

## Status

Accepted — 2026-08-10. Implementation deferred to v1.1 (blocked on credential
creation).

## Context

ADR-003 makes the interactive login IdP-agnostic. A **headless** path — filling a
form from a stored credential, for unattended re-mint — cannot be agnostic: it
must name one IdP. Observed 2026-08-10 (read-only, no credentials submitted):

| IdP                                                     | Form                                                                      | Bot gate                                                              | Extra steps                                                                                                                  | Lockout blast radius           |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Clave TGR** — `autentica.tgr.cl/idp/oauth2/authorize` | `#rut`, `#password`, `#iniciarSesion`; server-rendered, real `name` attrs | none                                                                  | none                                                                                                                         | TGR only                       |
| Clave Tributaria — `www2.sii.cl/oauthsii-v1-org/`       | `#inputRut`, `#inputPass`, `#bt_ingresar`; no `<form>` element            | none seen                                                             | `#correo` + `#btn-verify-challenge` email challenge; forced-rotation block (`MCurrentPass2`/`MNewPass2`/`btn-actualizar-ct`) | **shared with the `sii` tool** |
| ClaveÚnica — `accounts.claveunica.gob.cl`               | `#uname`, `#pword`                                                        | `<input id="grctoken" name="token">` (reCAPTCHA) + `password-encoded` | —                                                                                                                            | —                              |

Note also that the Clave Tributaria IdP is **not** the login page the `sii` tool
already automates (`zeusr.sii.cl/AUT2000/…`) — different host, different
selectors, different challenge surface. There is no reuse to be had.

## Decision

- **ClaveÚnica will never have a credential path.** Filling its form headlessly
  requires producing a reCAPTCHA token, i.e. defeating bot detection. This is not
  a preference to be revisited; it is a line the project does not cross.
  Interactive login (a human typing into the real page) remains fully supported.
- **The headless path targets Clave TGR**, at
  `autentica.tgr.cl/idp/oauth2/authorize`, filling `#rut` / `#password` and
  clicking `#iniciarSesion` — letting the page's own form own the hidden
  `redirect_uri` / `state` / `client_id`.
- **CLI-only.** `credentialLogin` is exported from the `/cli` subpath, never the
  main barrel, so a future MCP surface cannot wire it. No password ever crosses a
  tool argument.
- **The clave lives in the OS keyring** behind the `SecretStore` seam, never on
  disk in plaintext. Only cookies are persisted, exactly as on the interactive path.
- **Exactly one attempt, never retried.**

## Alternatives Considered

1. **Clave Tributaria as the headless target.** Rejected. It is the credential the
   user already holds, which is genuinely convenient — but wrong-password attempts
   count against **SII's** lockout counter, which the separate `sii` tool depends
   on. A stale keyring entry after a password change would not merely break TGR
   automation; it would lock the user out of SII. Two independent processes burning
   one lockout counter is a failure mode worth paying to avoid.
2. **No headless path at all.** Reasonable, and the status quo until v1.1 — but it
   forecloses any unattended monitoring loop.

## Consequences

- Easier: failures are contained to TGR; the target form is the simplest and least
  likely to grow an MFA step.
- Obligation: a Clave TGR must be created **under the empresa's RUT**. TGR's own
  site steers users toward Clave Tributaria / ClaveÚnica, so this path may be
  legacy and could be retired.
- **Reopen this ADR if** Clave TGR turns out not to support empresa RUTs
  (ClaveÚnica is natural-persons-only, so that would leave Clave Tributaria as the
  only empresa-capable IdP and force alternative 1 to be re-argued), or if TGR adds
  a bot gate to `autentica.tgr.cl/idp/oauth2/authorize`.
