# ADR-011: Reading TGR's embedded apps, and the one POST this tool is allowed to make

## Status

Accepted — 2026-08-11. Refines ADR-006; resolves the "Generar Cupón de Pago" item
parked there. Builds on ADR-010's boundary (take the identity, not the capability).

## Context

Reconnaissance against a live session (2026-08-11) established how TGR actually
serves authenticated data. Every trámite page on `web.tesoreria.cl` is a **WordPress
shell** that embeds the real application in an `<iframe>`, reached through a `vr=`
hand-off **minted fresh on every page load** (observed: four page loads, four
distinct tokens, timestamps seconds apart):

| Trámite page                                | Embedded app (all on `www.tesoreria.cl`)      |
| ------------------------------------------- | --------------------------------------------- |
| `/tramites-tgr/pago-impuestos-fiscales/`    | `/ImpuestosFiscalesWEB/`                      |
| `/tramites-tgr/pago-total-deudas-fiscales/` | `/CbrPagoTotalRutInterWeb/pagoTotal/tipoPago` |
| `/tramites-tgr/mi-cartola-fiscal/`          | `/CartolaFiscalInterWeb/cartolaFiscal/begin`  |
| `/tramites-tgr/convenios-vigentes/`         | `CognitoController.jpf`                       |

Two facts follow, and the first corrects an earlier assumption in this repo:

1. **The fiscal/aduanero debt data is NOT on a payment host.** It lives in
   `ImpuestosFiscalesWEB` on `www.tesoreria.cl`, an APP host. An earlier reading —
   that the debt list lived inside `centro-pagos.tgr.cl` — was inferred from a
   marketing page's "Ir a Pagar" button and was wrong. ADR-006's host denylist does
   not block this surface. The `centro-pagos.tgr.cl` links present on these pages are
   the global nav menu, identical on every page including the cartola.
2. **`ImpuestosFiscalesWEB` gates its listing behind a POST**, and the choice offered
   is a payment mode (observed values, not guessed):

   ```
   form#formc  →  POST /ImpuestosFiscalesWEB/consultaDeudasFiscales
     input[name=tipoPago][value=PortalFiscalEnLinea]     "Pagar en línea"
     input[name=tipoPago][value=PortalFiscalPresencial]  "Imprimir comprobante de pago"
     input#aceptar[type=submit]                          "ACEPTAR"
   ```

   The listing endpoint is literally named `consultaDeudasFiscales`. It cannot be
   reached without submitting one of those two values. A tool that never POSTs cannot
   read the debts this project was created to read.

## Decision

### Embedded apps are read by rendering, never by token replay

- To read an embedded app, navigate the session to the **trámite page** and let the
  iframe load as a browser would, then read inside that frame.
- **Never construct, extract, store, or replay a `vr` token.** ADR-010 drew this line
  for identity; it holds here. We render the page the user would see.
- Two seam methods are added to `PortalSession`, both scoped to a frame matched by a
  URL fragment: `evaluateInFrame` (read) and `clickInFrame` (interact). Keeping frame
  access behind the seam preserves ADR-002 — the core still never imports Playwright.

### Exactly one POST is permitted, and it is enumerated

- The tool may submit `tipoPago=PortalFiscalPresencial` ("imprimir comprobante"),
  **solely** to pass the gate into `consultaDeudasFiscales`.
- **The payment-branch value must never appear in the CODE.** It is declared once, in
  `config/payment-denylist.ts`, and `no-payment.test.ts` walks every other `.ts` file
  under `packages/*/src` and fails the build if it finds it. Naming it in THIS ADR and
  in the wire contract is deliberate and outside that scope: documentation is where
  observations of TGR's forms belong, exactly as payment hostnames are documented while
  being banned from code.
- **We stop at the listing.** No cupón is generated, no "pago total" branch is
  entered, no payment control is clicked. Reading the debts is the end of the flow.
- This is the resolution of the cupón question ADR-006 parked: generating a cupón
  remains **out of scope**. Selecting the non-payment _mode_ in order to reach a
  consulta screen is not generating one.

### What the read-only promise now means, stated precisely

"Read-only by construction" no longer means "issues no POST". It means:

> This tool never moves money, never generates a payment instrument, and submits
> nothing to TGR except one enumerated, non-transactional mode selector required to
> reach a consulta screen.

That is weaker than the original claim and is stated here rather than quietly
absorbed. ADR-006's core guarantee — no payment code path exists, enforced by a test —
is untouched.

## Alternatives Considered

1. **Navigate the top-level page straight to the iframe's `src`.** Simpler (no frame
   seam, existing `evaluate` works). Rejected: the `src` carries the `vr` token, so
   lifting it out of the DOM and navigating to it is materially closer to replaying a
   capability than letting the browser load its own iframe. The seam is worth the cost
   of keeping that line bright.
2. **GET-only: find a way to reach `consultaDeudasFiscales` without the POST.** Not
   available — the gate is mandatory and the endpoint is POST-only.

   **Re-checked 2026-08-12 and still not available.** The convenios app carries a menu
   item "Deudas Fiscales" pointing at a plain GET link
   (`limpiasessionstateful.jsp?redir=misdeudasfiscales.jsp`), which looked like exactly
   the gate-free route that would let this exception be withdrawn. Following it returns
   a **WebLogic `JSP compile error`** — the page does not compile in TGR's production.
   The alternative was sought and does not exist; the one permitted POST stays.

3. **Submit `PortalFiscalEnLinea` because it is "just a mode".** Rejected outright. It
   is the branch that leads to taking money, and it will not exist in this codebase.
4. **Abandon the surface and keep "submits nothing" absolute.** Genuinely defensible,
   and it was offered as the alternative. Rejected by the project owner: the
   fiscal/aduanero debts (the DIN charges) are the reason this project exists, and a
   tool that cannot read them fails its purpose.

## Consequences

- Easier: the DIN-relevant debt listing becomes reachable, and the same
  render-the-iframe pattern generalises to cartola, convenios and pago-total reads.
- Harder: the tool now depends on a form's field VALUES, not just selectors. If TGR
  renames `PortalFiscalPresencial`, the read fails — loudly, by design, rather than
  silently selecting the other option. The facade must assert the expected value is
  present before submitting and refuse to proceed otherwise.
- Obligation: `README.md` and `CLAUDE.md` must carry the precise wording above, not
  the older absolute phrasing.

## Follow-up — 2026-08-12: the bootstrap, diagnosed

`CartolaFiscalInterWeb`'s `Usuario No Autorizado` is **not** a broken surface and not a
single-use token. Isolated by running three scenarios in fresh contexts from one jar:

| Scenario                                    | Result                     |
| ------------------------------------------- | -------------------------- |
| cartola alone, first load in a cold context | ❌ `Usuario No Autorizado` |
| same context, second load                   | ✅ renders                 |
| deudas app first, then cartola              | ✅ renders first time      |

The app refuses the first hand-off until **some** app has established a session on
`www.tesoreria.cl`; the very next navigation is accepted. `ImpuestosFiscalesWEB` does
not need it, which is why the deudas read worked immediately.

Handled by `portal/tramite.ts` `openTramite`, which every read surface now goes
through: navigate, detect the access-error state, and if present pace once and
re-navigate — **exactly once, never in a loop.** This is a bootstrap, not a retry:
CONVENTIONS forbids retrying after TGR _rejects_ something, and here TGR has rejected
nothing — the app is reporting that its session is not up yet.

Two further hardenings came out of live use:

- **`openTramite` returns the landed URL stripped of query and hash.** Once the shell's
  script runs, its own URL carries the signed `vr` hand-off; callers only ever need
  origin + path, so returning it raw would leak a live token into logs and errors.
- **Look before touching.** The `tipoPago` form stays in the DOM, hidden, once the
  listing renders, so a second consecutive run timed out trying to tick a hidden radio.
  The facade now scrapes first and only interacts when the listing is genuinely absent
  and the control is genuinely actionable — which also means fewer interactions with
  TGR, the right default under this ADR.
