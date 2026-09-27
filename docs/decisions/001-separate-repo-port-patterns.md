# ADR-001: Separate repo — port the `sii` patterns, do not import `sii-core`

## Status

Accepted — 2026-08-10.

## Context

`tesoreria` is a companion to the existing `sii` monorepo: same author, same
architecture, adjacent domain (Chilean tax administration). The obvious question
is how much code to share. `sii` is a working, **published** tool
(`@dostertags/sii-core@0.6.0` on public npm) whose core already contains
`Rut`, the seam interfaces, a Playwright `PortalDriver`, and Node adapters for
store/audit/clock — all of which `tesoreria` needs shaped versions of.

Against that, first-hand observation of TGR (2026-08-10) shows the auth model
differs in kind, not degree: TGR is an OAuth2 authorization-code flow over AWS
Cognito with three federated IdPs, spanning five origins and three registrable
domains. `sii-core`'s `PortalDriver` contract encodes the opposite assumption —
`interactiveLogin({ destination, timeoutMs })` where `destination` is a **closed
union containing exactly one SII URL**, and success is `hostname !== 'zeusr.sii.cl'`.

## Decision

`tesoreria` is a **separate repository** with its own monorepo, its own package
scope entries (`@dostertags/tgr-core`, `@dostertags/tgr-cli`), and its
own ADR series starting at 001.

It **ports the architecture** — ports & adapters, injectable seams, tasks-only
surfaces, the CFD context layer, the operating guardrails — by re-writing it for
TGR, exactly as `sii` itself ported the Python `sii-cli`. It takes **no runtime
dependency on any `sii` package**, and no `sii` repo file is modified.

The overlap that is duplicated rather than shared: `Rut` (Mod-11), the
store/audit/clock Node adapters, the Windows ACL helper, the error base class.
Roughly 10 KB of source.

## Alternatives Considered

1. **New packages inside the `sii` monorepo.** Rejected — couples release cycles
   of a published tool to a greenfield one, and turns a repo named for one portal
   into an unnamed umbrella.
2. **Extract a shared `portal-core` kernel first, then build both on it.**
   Rejected — it is a breaking refactor of a live published package, designed
   before a single line of TGR code exists. The abstraction would be derived from
   zero evidence about the second consumer, which is precisely how wrong
   abstractions are made.
3. **Separate repo that npm-depends on `@dostertags/sii-core`.** Rejected on
   evidence: the seam most worth sharing (`PortalDriver`) is the one that does not
   fit, and `sii-core`'s config module opens by declaring itself the single source
   of truth for **SII** hostnames.

## Consequences

- Easier: TGR churn cannot destabilise a released tool; the login layer is free to
  be shaped by what TGR actually is.
- Harder: ~10 KB of duplicated primitives, and a bug fixed in `Rut` must be fixed
  twice. Accepted deliberately — the duplication is small, stable, and fully
  covered by tests on both sides.
- Obligation: **revisit extraction after TGR's login is proven.** At that point
  the shared kernel can be designed from two real consumers instead of one and a
  guess. Until then, resist it.
