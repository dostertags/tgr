# ADR-007: Scope is TGR only — Aduanas is out, including as a prepared seam

## Status

Accepted — 2026-08-10.

## Context

The stated motivation for this project is _"impuestos fiscales como por ejemplo
importaciones DIN"_. That phrase spans two institutions:

- The **DIN** (Declaración de Ingreso) is a **Servicio Nacional de Aduanas**
  document. The declaration detail — tariff classification, CIF value, ad-valorem,
  IVA de importación, line items — lives at Aduanas.
- **TGR** holds the **derived charge**: the giro/deuda for those gravámenes, its
  payment state, and any convenio, listed under "Impuestos Fiscales y Aduaneros"
  alongside the taxpayer's other fiscal debts.

So "read my DIN situation" resolves to a different portal depending on which half
is wanted. Aduanas is a separate portal with its own authentication, which would
mean a second driver, a second session model, and a second wire-contract layer.

## Decision

- **v1 and the foreseeable roadmap cover TGR only.**
- **`aduana.cl` appears nowhere in this repository** — not as a constant, not as a
  commented-out seam, not as a "prepared for later" abstraction.
- If Aduanas is added later it gets its own repository, by the same reasoning as
  ADR-001.

## Alternatives Considered

1. **Build a two-portal abstraction now, implement TGR first.** Rejected — it
   means designing an abstraction over two auth models having validated **zero**.
   ADR-001 rejected the same move for the same reason; doing it here would be
   inconsistent.
2. **Add Aduanas immediately after login works.** Deferred rather than rejected,
   but it is not the current plan.

## Consequences

- Easier: one auth model to get right; the whole of v1's risk is concentrated in
  one place.
- Harder: a reconciliation question — _"does what I was charged match what I
  declared?"_ — is **structurally unanswerable** by this tool alone. If that turns
  out to be the real goal, this repo is explicitly the first half, and that should
  be acknowledged rather than papered over.
