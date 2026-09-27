# ADR-009: Session-anatomy capture runs inside the login flow, behind a widened seam

## Status

Accepted — 2026-08-10.

## Context

ADR-005 and ADR-008 both end in "resolved by the first live login": whether cookies
alone restore a session, what the token lifetime is, and where the principal's RUT
comes from. **Only a successful login answers these**, and if that run does not
capture its findings they will be re-derived repeatedly.

The architecture constrains where such a capture can live. Per ADR-002 the core
never imports Playwright — only `adapters/node/portal.ts` does — and surfaces call
tasks only. Reading `Object.keys(localStorage)` needs a live page, which only the
adapter has.

`sii` has an established precedent for diagnostics: `tools/crawler` reaches a live
`PortalSession` through the `/node` composition subpath, which its `node.ts`
documents as the sanctioned escape hatch for _"internal tooling that is explicitly
not a CLI/MCP surface"_.

## Decision

- **`PortalSession` gains an `anatomy()` method**, implemented in the Playwright
  adapter and stubbed by the fake, returning the landed URL, **cookie names grouped
  by domain**, and **storage key names grouped by origin**.
- **Names only. Never values.** Not cookie values, not token contents, not
  `localStorage` values. The capture answers "what shape is this session", which
  needs no secret material.
- **`login()` calls it when `observe` is set**, before the browser closes —
  surfaced as `tgr auth login --observe`.
- **Rendering is a pure function** in `observe/`, so it is unit-tested without a
  browser; the CLI owns writing the file.
- **Raw output is gitignored** (`docs/tgr-contract/*.observed.md`). Only a
  human-reviewed, redacted summary graduates into `docs/tgr-contract/auth-login.md`
  — the same discipline `sii` applies to crawler captures.

## Alternatives Considered

1. **A separate `tools/` spike, following `sii`'s `tools/crawler` precedent.**
   Rejected despite the better precedent, for a decisive reason: such a spike must
   `restore()` from the persisted jar to obtain a session — but the open hypothesis
   is precisely _"the cookies-only jar may not restore"_. If cookies are
   insufficient the spike gets a logged-out browser and observes nothing, failing in
   exactly the case it exists to diagnose. The observation must happen while the
   freshly-minted context is still open, which forces it into the driver.
2. **One-shot manual observation with DevTools.** Zero code, and genuinely viable —
   all of ADR-003's and ADR-004's evidence came from manual browser recon. Rejected
   because it is not repeatable: when TGR changes its auth, `--observe`
   re-diagnoses in one command whereas manual recon starts from scratch.

## Consequences

- Easier: v1's real deliverable — _knowing what the session is_ — is produced by
  the same command that logs in.
- Harder: one extra method on a seam for a diagnostic concern, which every
  `PortalSession` implementation must provide. Judged cheap: the fake stubs it in
  three lines.
- Obligation: keep `anatomy()` names-only. If a future need tempts a value into it,
  that needs a new ADR, not a patch.
