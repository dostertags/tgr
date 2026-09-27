# Conventions

Ported from `sii`, where each of these was learned the hard way. New conventions
get appended here in the same commit that fixes the pattern the second time.

## Operating posture toward TGR

- **Pace at ~1 request/second.** Multi-call fan-outs sleep via `Clock.sleep`, never
  a bare `setTimeout`, so tests don't wait.
- **Never retry after a rejection.** Not after a failed login, not after a block,
  not after an unexpected error envelope. Surface it and stop. Repeated login
  failures lock the account — and for the Clave Tributaria IdP that lockout counter
  is **shared with the separate `sii` tool**, so a retry loop here can lock you out
  of both.
- **A bootstrap is not a retry.** Some embedded apps refuse the FIRST hand-off in a
  cold context and accept the very next one — they are reporting that their session
  is not up yet, not rejecting us. Go through `openTramite`, which re-navigates
  **exactly once**, paced. Never generalise this into a retry loop.
- **Look before touching.** Scrape for the data you want first; only interact with a
  control when the data is genuinely absent AND the control is genuinely actionable
  (present in the DOM is not enough — TGR leaves hidden forms behind). Fewer
  interactions is both more robust and the right posture for a read-only tool.
- **Wait for the data, not for a load state.** An embedded app's frame is findable by URL before
  its document has rendered, and a page-level `networkidle` says nothing about a frame. Twice now
  a read scraped too early (the `clickInFrame` submit, 2026-08-12; the cartola dashboard and
  the deudas app, 2026-09-26). Poll the frame for the thing you are about to read via `readFrameWhenReady` —
  bounded, paced, local DOM only, so not a retry.
- **Exactly one login attempt per invocation.** `credentialLogin` submits once.
- **A completed login is never discarded by an optional follow-up.** Once the landing and
  `userCognito` post-conditions pass, the session is persisted even if a later step (identity
  read, probe navigation) fails. Throwing it away forces the user through another login — and
  every extra login spends the lockout budget (observed 2026-09-26, twice).
- **Budget navigations for TGR's worst case, not its median.** `tgr.gob.cl` reached
  DOMContentLoaded anywhere from 10s to 64s for the same URL within minutes (observed
  2026-09-26); Playwright's 30s default is too tight. See `NAV_TIMEOUT_MS`.
- **Production is the only target.** No env switch, no staging host.
- **No third-party TGR library.** Every selector, endpoint, and payload shape is
  derived from first-hand observation of the live surface, **dated** and cited in a
  code comment, e.g. `// observed 2026-08-10`.

## Error surfacing

- **Pass TGR's Spanish messages through unchanged.** A paraphrase costs the user
  the exact string they need to search for. Wrap, never translate.
- **Fail loud when a scraper breaks.** If a page shape changed, raise — never
  silently map an unrecognised structure onto curated fields.
- **Absence is not an error.** An empty list is a legitimate result and must not
  raise.

## Security & PII

- **The clave never enters this process** on the default path, never lands on
  disk, and never crosses a tool argument.
- **The session RUT is asserted by the portal**, never supplied by the caller.
- **Never log a secret.** `recordAudit` drops keys matching
  `password|clave|cookie|secret|token` at every depth; do not defeat it.
- **Never commit real PII** — RUT, razón social, email, amounts, cookie values.
  Wire-contract docs record **types and key names**, with values redacted or
  synthetic.
- **Raw captures never graduate to git automatically.** `--observe` output is
  gitignored; a human curates the redacted summary into `docs/tgr-contract/`.

## Code

- Relative imports carry the `.js` specifier (`NodeNext`).
- `import type` for type-only imports (lint-enforced).
- Comments explain **why**, and cite the ADR or observation date that justifies a
  non-obvious choice.
- Colocated tests: `foo.ts` ↔ `foo.test.ts`.
- Prefer inline structured data over DOM scraping when a page offers both.
- Pure logic is extracted from adapter shims so it can be unit-tested without a
  browser (e.g. the ACL command builder, the anatomy renderer).

## Output

- The CLI emits **JSON by default** (it is a faithful façade over the core's data
  contract); `--human` switches to readable text.
- Diagnostics go to STDERR so STDOUT stays pipeable.
