# ADR-008: Single-principal identity (empresa) — no `operate` pointer

## Status

Accepted — 2026-08-10.

## Context

`sii` carries a substantial identity model (its ADR-005): an operable set fetched
at login from a documented SII endpoint, an `operate` pointer selecting which RUT
a call acts as, and a split between session-keyed and body-RUT surfaces.

Two facts bear on whether `tesoreria` needs any of it:

1. **No evidence TGR exposes an operable set.** `sii`'s model is justified by a
   real endpoint returning representable empresas and by facades that accept a RUT
   in the request body. Nothing equivalent has been observed at TGR.
2. **The IdP determines which RUT you can be.** ClaveÚnica authenticates a natural
   person's RUN and can never make you the empresa. Clave Tributaria and Clave TGR
   can be held by an empresa RUT. The user will authenticate **as the empresa**.

## Decision

- **One principal per session, and no `operate` pointer.** The authenticated RUT is
  the only RUT the tool acts as. Switching principals means `logout` → `login` —
  which is already `sii`'s rule (one live session at a time).
- **The session RUT is asserted by the portal, never supplied by the caller.**
  Ported verbatim from `sii` ADR-006; the mechanism changes, the principle does not.
- **`~/.tgr/session.json` keeps the `{ rut, cookies, savedAt }` shape** even though
  nothing consumes an operate pointer, so introducing one later needs no migration.
- **Where the RUT comes from is an open empirical question.** There is no
  `DatosCntrNow` here. Likely candidates are Cognito **id_token** claims (note
  ClaveÚnica's requested scope is literally `openid run name`) or an `api.tgr.cl`
  call. Resolved by the first live login and recorded in the wire contract.

## Alternatives Considered

1. **Port `operate` wholesale.** Rejected — machinery with nothing to populate it.
   Speculative generality at exactly the layer where a wrong guess is most
   expensive.
2. **Multi-session store (several principals cached side by side).** Rejected for
   v1 — the user authenticates as one entity, so it would be built for nobody.
   Worth revisiting only if a personal-plus-empresa workflow actually appears.

## Consequences

- Easier: `withSession` has no precedence rules to resolve; there is no operable-set
  fetch to fail at login; the CLI needs no `--rut` flag and no operating-as header.
- Harder: if TGR does expose representación, this will need revisiting. The session
  file shape is chosen so that revisit is additive.
- **Depends on ADR-004's open item:** the Clave TGR must be created under the
  empresa's RUT. If empresa RUTs are unsupported there, both ADRs move together.

## Progress — 2026-08-10

`rut` is still `null`, as designed — but the source is no longer unknown. The
authenticated cartola on **`web.tesoreria.cl`** renders the empresa's razón social in
its page header, so the principal's identity is readable from the authenticated site
rather than from a Cognito claim. The exact selector or inline object is not yet
pinned down; that is the next increment, and it lands with the first read surface.

No change to the decision: one principal, no `operate` pointer.
