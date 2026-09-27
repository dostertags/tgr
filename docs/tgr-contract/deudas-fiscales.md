# Wire contract — deudas de impuestos fiscales y aduaneros

Observed **2026-08-11** against the live TGR portal. First-hand observation, no third-party
library. All concrete values below are **redacted / synthetic** — real folios, amounts and RUT are
PII and MUST NOT land here.

Surface: `@dostertags/tgr-core` `listDeudasFiscales` (`tasks/deudas.ts`) over
`fetchDeudasFiscales` (`portal/deudas.ts`). CLI: `tgr deudas list`.

This is the **read half of the DIN surface** — TGR holds the charge derived from an Aduanas
import declaration, not the declaration itself (ADR-007).

## How TGR serves authenticated data

Every trámite on `web.tesoreria.cl` is a **WordPress shell** that embeds the real Java application
in an `<iframe>`, reached through a `vr=` hand-off **minted fresh on every page load** (four loads
observed, four distinct tokens, timestamps seconds apart):

```
https://web.tesoreria.cl/tramites-tgr/pago-impuestos-fiscales/     ← the shell we navigate to
   └── <iframe src="https://www.tesoreria.cl/LoginPortalPagosTGR/redirect?vr=<BASE64>">
          └── https://www.tesoreria.cl/ImpuestosFiscalesWEB/       ← the app
```

The `vr` payload has the same six-field shape as the identity hand-off (see `auth-login.md`); its
field 4 names the target app. **We never construct or replay it** — we navigate to the shell and
let the iframe load, then read inside that frame (ADR-011).

Known shells and their apps (all on `www.tesoreria.cl`, an APP host — **not** a payment host):

| Shell                                       | Embedded app                                  |
| ------------------------------------------- | --------------------------------------------- |
| `/tramites-tgr/pago-impuestos-fiscales/`    | `/ImpuestosFiscalesWEB/`                      |
| `/tramites-tgr/pago-total-deudas-fiscales/` | `/CbrPagoTotalRutInterWeb/pagoTotal/tipoPago` |
| `/tramites-tgr/mi-cartola-fiscal/`          | `/CartolaFiscalInterWeb/cartolaFiscal/begin`  |
| `/tramites-tgr/convenios-vigentes/`         | `CognitoController.jpf`                       |

## ⚠️ The `tipoPago` gate

`ImpuestosFiscalesWEB` shows **no data** until a payment mode is chosen. Title on arrival:
`Búsqueda Deudas Impuestos Fiscales`.

```
form#formc  →  POST https://www.tesoreria.cl/ImpuestosFiscalesWEB/consultaDeudasFiscales
  input[type=radio][name=tipoPago]  ×2   (see below)
  input#aceptar[type=submit][name=aceptar][value=ACEPTAR]
```

| `tipoPago` value         | Label                          | This tool                                                                                                                 |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `PortalFiscalPresencial` | "Imprimir comprobante de pago" | **the only value ever submitted**                                                                                         |
| _(the other one)_        | "Pagar en línea"               | ⛔ forbidden — listed in `config/payment-denylist.ts`, absent from the rest of the tree, enforced by `no-payment.test.ts` |

The facade asserts the permitted option is present **before** clicking anything; if TGR renames
it, nothing is submitted and the read fails loudly (ADR-011).

## Listing

After the gate: `https://www.tesoreria.cl/ImpuestosFiscalesWEB/consultaDeudasFiscales`

A jQuery **DataTables** grid, `table#example.display.dataTable`:

| Column          | Parsed as                                                                    |
| --------------- | ---------------------------------------------------------------------------- |
| `FORMULARIO`    | string (TGR's charge-type code)                                              |
| `NRO FOLIO`     | string                                                                       |
| `VENCIMIENTO`   | `DD-MM-YYYY` → ISO `YYYY-MM-DD`; raw kept alongside                          |
| `TOTAL A PAGAR` | Chilean thousands separators (`1.234.567`) → integer CLP; raw kept alongside |

Footer text observed: `Seleccione "folio" para ver detalle del impuesto e imprimir.` — the per-folio
**detail** view is a further step and is **not implemented**: it is coupled to "imprimir", which
runs into the cupón question ADR-011 deliberately left out of scope.

Parsing rules (`parseDeudasTable`, pure and unit-tested):

- **Headers are asserted.** Any change raises `PortalReadError` rather than shifting values into
  the wrong fields (CONVENTIONS: fail loud when a scraper breaks).
- **An empty table is NOT an error.** Zero debts is a legitimate answer.
- **A total is withheld if ANY row failed to parse** (`totalCLP: null`) — a partial sum presented
  as "your total debt" would be a lie.

## Verified live

`tgr deudas list` was run end to end against the live portal (2026-08-12): the gate was passed
with the permitted value only, the grid scraped, and the row parsed with its total. Values are
withheld here — they are the empresa's real debt.

**⚠️ `VENCIMIENTO` came back as `01-01-1900`** — the classic null-date sentinel. Observed ONCE, so
this contract records it as an observation, not a rule: the parser reports it faithfully (ISO
`1900-01-01` plus the raw string) rather than silently mapping it to "no due date". If a second
account confirms the sentinel, that mapping becomes a deliberate, documented decision.

**A submit needs a FRAME-level wait, not a page-level one.** These apps replace the frame's
document, while the top-level page is already idle — so `page.waitForLoadState('networkidle')`
returns instantly and the caller scrapes the PRE-submit document, finding no table (observed
2026-08-12). Hence the seam separates `checkInFrame` (local tick, nothing to await) from
`clickInFrame` (submit: wait for the frame's URL to turn over, then its load event).

## ⚠️ Some embedded apps need a bootstrap load

`CartolaFiscalInterWeb` refuses the FIRST hand-off in a cold browser context
(`Mi Cartola Fiscal - Usuario No Autorizado`) and accepts the very next navigation.
Isolated 2026-08-12 across three fresh contexts from one jar: cartola-alone fails;
cartola-twice succeeds on the second; deudas-then-cartola succeeds first time. So the app
wants a session already established on `www.tesoreria.cl`.

`ImpuestosFiscalesWEB` does **not** need it — which is why the deudas read worked
immediately and the cartola looked broken.

All read surfaces go through `portal/tramite.ts` `openTramite`, which detects the
access-error state and re-navigates **once**, paced. That is a bootstrap, not a retry
(CONVENTIONS).

`openTramite` returns the landed URL **stripped of query and hash**: once the shell's script
runs, its own URL carries the signed `vr` hand-off, and callers only need origin + path.

## ⚠️ The gate form survives, hidden

After the listing renders, the `tipoPago` form is still in the DOM but not laid out. A second
consecutive `tgr deudas list` timed out ticking a hidden radio (observed 2026-08-12). The facade
therefore **scrapes first** and only interacts when the listing is absent AND the control has
client rects. Verified: two consecutive runs both succeed.

## ⚠️ The app frame exists before its document does

Observed 2026-09-26: the `ImpuestosFiscalesWEB` frame is findable by URL while its document is
still `loading` (~4s on a slow night), and the shell tears down and rebuilds its iframes once
before that. Looking at that moment found neither the listing nor the gate and reported a
structure change. `fetchDeudasFiscales` now waits (local DOM, bounded, paced) until either the
listing or the `tipoPago` input exists before it looks.

## Still open

- [ ] Per-folio detail (blocked on the cupón question — ADR-011 / ADR-006).
- [ ] Whether `FORMULARIO` codes distinguish aduanero (DIN-derived) charges from other fiscal
      ones. Only one row was present on the observed account, so the code space is unknown.
- [ ] Pagination: DataTables renders `Mostrar N registros por página`. With a single row the
      paging behaviour was not exercised — a multi-page account may need it.
- [ ] `CartolaFiscalInterWeb` answered `Usuario No Autorizado` when inspected on 2026-08-11.
      Cause unknown; the cartola read is blocked on diagnosing it.

## The convenios app (mapped 2026-08-12, not yet implemented)

Both `/tramites-tgr/convenios-vigentes/` and `/tramites-tgr/convenios-caducados/` land on the SAME
app menu — neither shell deep-links:

```
https://www.tesoreria.cl/convenios/internetWar/menu.jsp?RUT=<body>&DV=<dv>
```

Menu items are plain relative GET links, `limpiasessionstateful.jsp?redir=<page>.jsp&RUT=&DV=`:

| Item                                  | `redir=`                                  | Kind                                                                |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Convenios Vigentes                    | `conveniosvigentes.jsp`                   | read ✅                                                             |
| Convenios Caducados                   | `convenioscaducados.jsp`                  | read                                                                |
| Exclusiones SII / Tesorería           | `consultarexclusiones{sii,tesoreria}.jsp` | read                                                                |
| Deudas Territoriales                  | `miscuotasbienesraices.jsp`               | read                                                                |
| Deudas Fiscales                       | `misdeudasfiscales.jsp`                   | ⚠️ **broken on TGR's side — JSP compile error**                     |
| Comprobante / Estado de pago / Cuotas | `imprimir*.jsp`                           | document generation — out of scope (ADR-011)                        |
| Pagar cuotas de convenios vigentes    | absolute `tgr.cl` URL, `target=_top`      | ⛔ payment — trivially distinguishable from the relative read links |

`conveniosvigentes.jsp` renders a layout table (no `<th>`; **row 0 holds the headers**):

```
N° | N° Resolución | Fecha Resolución | Tipo Pago | N° Cuotas | N° Deudas | Saldo Neto Actual($)
```

Empty state, observed verbatim: `El contribuyente no posee convenios con Tesorería`.

Two notes for whoever implements this:

- **The menu renders every item TWICE**, one copy inside a collapsed section. `querySelector`
  returns the hidden one first, so a plain click times out on visibility — target the visible copy
  (`…:visible`) rather than the first match.
- The observed account has **zero convenios**, so only the empty path can be verified today. A
  populated parse would be unverified until an account with a convenio exists.
