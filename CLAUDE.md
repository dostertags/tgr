<!-- ~80–120 tokens loaded at session start. Keep it an INDEX, not an encyclopedia. -->

# Project: tesoreria — TypeScript core + CLI for TGR Chile

## What This Project Does

A TypeScript monorepo that automates routine **read** interactions with Chile's
Tesorería General de la República (TGR — `tgr.gob.cl`) for a single empresa
principal. Companion to the `sii` tool: same architecture, different portal.
One shared domain core (`@dostertags/tgr-core`) backs the surfaces; v1
ships a **CLI** only (an MCP server is a later increment).

Patterns are PORTED from the proven `sii` monorepo; the code is written new and
no `sii` package is imported (ADR-001). TGR's auth differs in kind from SII's —
OAuth2/Cognito across three federated IdPs, not one RUT+Clave form — so the
login layer is designed from first-hand observation, not copied.

## Architecture

@docs/ARCHITECTURE.md

## Tech Stack

@docs/STACK.md

## Conventions

@docs/CONVENTIONS.md

## Roadmap

@docs/ROADMAP.md

## Key Decisions

@docs/decisions/_index.md

## Wire Contracts

@docs/tgr-contract/auth-login.md
@docs/tgr-contract/deudas-fiscales.md
@docs/tgr-contract/cartola-fiscal.md

## Build & Run

- Install: `pnpm install`
- Build all packages: `pnpm build` (`tsc -b`)
- Typecheck: `pnpm typecheck`
- Test: `pnpm test` (vitest)
- Lint / format: `pnpm lint` / `pnpm format`
- One package: `pnpm --filter @dostertags/tgr-core <script>`

## Critical Rules

- **THIS TOOL NEVER PAYS.** Precisely: it never moves money, never generates a
  payment instrument, and submits nothing to TGR except **one enumerated,
  non-transactional mode selector** (`TIPO_PAGO_COMPROBANTE`) required to reach a
  consulta screen. Payment hosts AND the forbidden payment-branch form value live in
  `config/payment-denylist.ts`; `no-payment.test.ts` FAILS THE BUILD if any other
  module references either. TGR is a collections agency: a mistake here moves real
  money irreversibly. (ADR-006 / ADR-011)
- **Embedded apps are read by rendering, never by token replay.** Every trámite is a
  WordPress shell embedding a Java app via a signed, time-bound `vr` hand-off. Navigate
  to the SHELL and read inside the iframe; never construct, store, or replay a `vr`
  URL. (ADR-010 / ADR-011)
- **Never hard-code a TGR hostname.** Read from `@dostertags/tgr-core`
  config. Prod is the only target; there is no env switch. (ADR-002)
- **Surfaces call `@dostertags/tgr-core` tasks only.** The CLI NEVER reaches
  past the task layer into the portal facades — that bypasses pacing, the audit
  log, and credential handling. (ADR-002)
- **External dependencies go through injectable seams.** Portal driver, secret
  store, key-value store, audit sink, and clock are interfaces with Node default
  implementations, so unit tests substitute fakes and never touch real TGR /
  keyring / clock. (ADR-002)
- **Secrets never touch disk in plaintext and never reach the LLM.** The clave is
  typed by the user into the IdP's real page (browser login, cookies-only) or held
  in the OS keyring (CLI only, Clave TGR only). No password ever crosses a tool
  argument. Never commit `*.pfx`, `*.p12`, `.env`, or anything under `.tgr/`.
  (ADR-005 / ADR-004)
- **Authentication success is detected by the TERMINAL APP ORIGIN**, never by
  "left the login host". `www2.sii.cl`, `accounts.claveunica.gob.cl`, `api.tgr.cl`
  and `id-auth.tgr.cl` are legitimate mid-flow waypoints. (ADR-003)
- **Never automate ClaveÚnica credential entry.** Its form is reCAPTCHA-gated
  (`grctoken`); filling it headlessly means defeating bot detection. Interactive
  login — where the human types into the real page — is the only ClaveÚnica path.
  (ADR-004)
- **One login attempt, never retried.** Repeated failures lock the account. This
  is doubly true for the Clave Tributaria IdP, whose lockout counter is shared
  with the separate `sii` tool. (docs/CONVENTIONS.md)
- **No third-party TGR libraries.** Every selector, endpoint, and payload shape is
  derived from first-hand observation of the live TGR surface, dated and cited in
  a code comment. (docs/CONVENTIONS.md)
- **Decisions get an ADR BEFORE implementation.** About to add a dependency, move
  a layer boundary, or pick between plausible patterns? Write the ADR first.
- **Corrections become conventions.** Fix the same pattern twice → write it into
  `docs/CONVENTIONS.md` in the same commit.
- **Absolute rule — no AI attribution anywhere.** Claude, GPT, Copilot, or any AI
  tool must NEVER appear as co-author, generator, or reference in commits, PR
  titles/bodies/comments, issues, branch names, code comments, docs, or any
  artifact that lands in git. Authorship is the human owner.

<!--
This file is the INDEX, not the encyclopedia. Adding paragraphs here? Move them to
a docs/*.md file and @reference it. Target ≤150 lines.
-->
