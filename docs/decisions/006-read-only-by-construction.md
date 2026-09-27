# ADR-006: Read-only by construction — no payment surface exists, enforced by a test

## Status

Accepted — 2026-08-10. **This ADR does not get relaxed by configuration.**

## Context

The `sii` tool is overwhelmingly a reading tool; its one write (`bte emit`) issues
a document and is gated by `SII_MCP_ALLOW_WRITES` plus a preview-minted, one-use,
hash-bound confirmation.

**TGR is a collections agency, and that changes the risk class.** Observed
2026-08-10: "Pago de Impuestos Fiscales y Aduaneros" — the surface holding the
import/DIN charges this project exists to read — presents the debt list and the
**Pagar** action in the same view, with `centro-pagos.tgr.cl` one click away.
`contribuciones.tgr.cl/main/contribuciones/conclave` is likewise a payment entry
point.

`sii` ADR-026 already established the governing insight: _no argument-based check
can protect a destructive tool exposed to a model, because the model writes all
the arguments_ — which is why the right answer there was **not registering the
tool** rather than validating it. Payment sits strictly further along that axis: a
boleta can be annulled; a transfer cannot be un-sent.

## Decision

- **No payment code path exists in this repository.** Not gated, not disabled, not
  behind an env var — **absent.** No task, facade, CLI command, or future MCP tool
  may issue a request to a TGR payment surface.
- **Payment hosts are declared in one module**, `config/payment-denylist.ts`, with
  a `⛔` comment naming why each is listed.
- **A test enforces it.** `no-payment.test.ts` walks every `.ts` file under
  `packages/*/src`, excluding only the denylist module itself and the test, and
  **fails the build** if any of them references a denylisted host. The rule is
  executable, not a comment someone can forget during a refactor.
- This applies regardless of surface. There is no "CLI-only payment" carve-out.

## Alternatives Considered

1. **Env-gated payment, mirroring `sii` ADR-026 / `SII_MCP_ALLOW_WRITES`.**
   Rejected — that pattern was designed for a reversible document issuance. The
   gate protects against an LLM invoking the tool; it does not protect against the
   tool existing and being invoked by anything else.
2. **CLI-only payment with a minted `--confirm`, mirroring `bte emit`.** Rejected —
   substantial machinery (one-use tokens, expiry, amount-hash binding) built to
   guard a capability whose entire value is saving one click on a page the user is
   already authenticated into. The cost/benefit does not survive contact with
   "irreversible".
3. **Say nothing and simply not implement payment.** Rejected — an unwritten rule
   is not a rule. Without the denylist and the test, the first person adding a
   "just read the total due" facade points it at the payment host by accident.

## Consequences

- Easier: the tool cannot lose money. Auditing that claim is a single test run.
- Harder: this caps the project permanently. A workflow that ends in "and then pay
  it" will always end outside this tool. Accepted knowingly.
- **Parked, needs its own ADR before any code:** "Generar Cupón de Pago" creates a
  payment _instrument_ without moving money. It is neither a clean read nor a
  payment, and this ADR does not settle it.
