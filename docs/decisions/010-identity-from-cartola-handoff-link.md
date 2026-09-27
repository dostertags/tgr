# ADR-010: Read the principal's identity from the cartola hand-off link

## Status

Accepted — 2026-08-10. Closes the open item in ADR-008.

## Context

ADR-008 fixed the identity model (single principal, no `operate`) but left the
**source** unresolved: TGR has no `DatosCntrNow` equivalent, and the terminus of a
successful login is TGR's own broken-redirect 404, which carries nothing at all.
Until now `StoredSession.rut` was honestly `null`.

Reconnaissance against a live session (2026-08-10) found the identity on the
**authenticated** cartola page (`web.tesoreria.cl`), in the hand-off link that leads
into the cartola application:

```
https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/
  ?go=https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=<BASE64>
  &no=<razón+social>
  &ap=
```

`vr` base64-decodes to six comma-separated fields (values redacted):

| #   | Field                                                            | Use                                     |
| --- | ---------------------------------------------------------------- | --------------------------------------- |
| 0   | 32-char opaque token                                             | never read                              |
| 1   | ISO timestamp                                                    | never read — the hand-off is time-bound |
| 2   | RUT body                                                         | ✓                                       |
| 3   | 32-char signature                                                | never read                              |
| 4   | `/CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=<body>&DV=<dv>`  | ✓ (DV, and a cross-check of the body)   |
| 5   | IdP name (`ClaveTributaria` \| `ClaveUnica` \| `ClaveTesoreria`) | ✓                                       |

Together with `no=` on the outer link, that is RUT + DV + razón social + which IdP
authenticated the session.

## Decision

- **The principal's identity is parsed from the cartola hand-off link.** The parsing
  is a pure function (`portal/identity.ts`, `parseIdentityFromHandoffLink`), unit
  tested against synthetic values; the facade only supplies it with hrefs.
- **Fields 0, 1 and 3 are opaque and are never read, stored, or logged.** We take the
  identity, not the capability: the `vr` token is a signed, time-bound hand-off into
  the cartola application and this project has no business replaying it.
- **Cross-check, then fail closed.** The RUT body appears twice (field 2 and the
  `RUT=` query in field 4); they must agree, and the resulting `<body>-<DV>` must pass
  Mod-11. Any mismatch, malformed payload, or missing field yields `null` — never a
  confidently wrong RUT.
- **Resolution is best-effort and never fatal.** A login whose identity read fails is
  still a valid login; the session is stored with `rut: null`. The alternative —
  failing a successful authentication because a page changed shape — is worse.
- **Read on the fresh-login path, backfilled on the warm path.** After login we step
  from the 404 terminus to the authenticated cartola page to read it. On a warm
  session we are already standing on that page, so a jar minted before this ADR is
  backfilled at no extra cost.
- **Razón social is PII.** It is stored locally (`0600` + Windows ACL) and returned to
  the user who asked to log in, but **never reaches the audit receipt** — only the RUT
  does, which is not a secret.

## Alternatives Considered

1. **Decode the Cognito `id_token`.** Rejected — there is no token to decode. The
   exchange is server-side and app-origin `localStorage` is empty (ADR-005); no JWT is
   ever exposed to the browser.
2. **Scrape the razón social from the page header.** It renders there, but only the
   name — no RUT, and no IdP. The hand-off link carries all three in a structured,
   parseable form.
3. **Call the cartola application itself and read identity from its response.** That
   means replaying the signed hand-off token to reach a data surface, which is a
   bigger step than identity warrants and belongs with the cartola read surface, under
   its own ADR.

## Consequences

- Easier: `tgr auth status` now answers "who am I", and the IdP field makes visible
  whether this session's lockout counter is shared with the `sii` tool (ADR-004).
- Harder: this depends on TGR keeping a hand-off link on the cartola page, and on the
  field order inside `vr`. Both are recorded in `docs/tgr-contract/auth-login.md`, and
  the cross-check means a layout change degrades to "unknown" rather than to a wrong
  RUT.
- Obligation: if a future read surface needs the cartola application itself, that is a
  new ADR — do not grow this one into a token-replay mechanism.
