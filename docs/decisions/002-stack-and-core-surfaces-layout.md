# ADR-002: Stack and layout — TypeScript, pnpm monorepo, core + thin surfaces

## Status

Accepted — 2026-08-10. Lineage: `sii` ADR-002 / ADR-003 / ADR-007.

## Context

ADR-001 settled that patterns are ported. This ADR records **which** patterns, so
the port is checkable rather than vibes-based, and so a reader can tell a
deliberate divergence from an accident.

## Decision

- **TypeScript on Node ≥ 20, ESM, `NodeNext`**, `strict` plus
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. pnpm workspaces,
  `tsc -b` project references, vitest, eslint + prettier. Detail in
  `docs/STACK.md`.
- **One domain core** (`@dostertags/tgr-core`) with thin surfaces over it.
  v1 ships one surface, the CLI.
- **Surfaces call tasks only.** The CLI never imports a portal facade, a session
  primitive, or Playwright. Reaching past the task layer bypasses pacing, the
  audit receipt, and credential handling.
- **External dependencies go through injectable seams** (`seams/index.ts`):
  `PortalDriver`, `PortalSession`, `KeyValueStore`, `SecretStore`, `AuditSink`,
  `Clock`. Node defaults in `adapters/node`, in-memory fakes in `adapters/fake`.
  The core imports neither `playwright` nor `node:*`.
- **Composition root on a subpath** — `@dostertags/tgr-core/node` — so
  importing the library's tasks never evaluates `node:*` or Playwright.
- **Playwright is an optional peer** of core, loaded lazily at first use, failing
  with an actionable message rather than at import time.
- **Never hard-code a TGR hostname** outside `config/`. Production is the only
  target; there is no env switch.
- **Modular core layout**: one directory per concern (`auth/`, `config/`,
  `errors/`, `rut/`, `audit/`, `observe/`, `format/`, `portal/`, `tasks/`), each
  with an `index.ts` barrel and colocated tests.

## Alternatives Considered

1. **Python, reusing the ecosystem the author already knows.** Rejected — the
   companion tool is TypeScript; two languages across two tools that will
   eventually share a kernel is a cost with no benefit.
2. **A single flat package.** Rejected — the CLI/core split is what keeps the
   guardrails un-bypassable, and it is what makes adding MCP later a no-design-risk
   increment.
3. **Playwright as a hard dependency of core.** Rejected — a consumer injecting
   its own `PortalDriver` should not pay a ~150 MB browser download.

## Consequences

- Easier: tests run against fakes and never touch TGR, the filesystem, or the
  clock; adding the MCP surface later is mechanical.
- Obligation: every new external dependency must arrive as a seam, not as a direct
  import in a task.
