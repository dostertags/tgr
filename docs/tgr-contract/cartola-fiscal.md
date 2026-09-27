# Wire contract — Mi Cartola Fiscal

Observed **2026-08-12** against the live TGR portal. First-hand observation, no third-party
library. All concrete values are **redacted / synthetic** — real amounts, counts and RUT are PII
and MUST NOT land here.

Surface: `@dostertags/tgr-core` `readCartola` (`tasks/cartola.ts`) over `fetchCartola`
(`portal/cartola.ts`). CLI: `tgr cartola`.

The cartola is the **12-month summary** of the principal's situation at TGR. It answers questions
the debt listing cannot: is anything in **collection**, are there **convenios**, what has been
**paid**.

## Reaching it

Shell `https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/` embeds
`https://www.tesoreria.cl/CartolaFiscalInterWeb/cartolaFiscal/begin` (which redirects to
`…/consultarDatosCartola`).

⚠️ **This is the app that needs the bootstrap.** It refuses the first hand-off in a cold context
with `Mi Cartola Fiscal - Usuario No Autorizado` and accepts the very next navigation — see
`auth-login.md` and ADR-011. Handled by `openTramite`.

## Structure

Built from **layout tables**: no `<th>`, **row 0 carries the headers**, and a row's cell count
varies with whether that type has anything in it. Sections are therefore identified by their
**header signature**, never by position.

Header row of the page: razón social + RUT, then three blocks — `Deudas`, `Pagos`, `Cobranza` —
under `Revisa tu situación en Tesorería correspondiente a los últimos 12 meses`.

| Section           | Header signature                                                                             | Curated?                   |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------- |
| Deudas            | `Tipo \| Vencidas N \| No Vencidas N \| No Liquidables N \| Monto Liquidado \| ¿Qué acción…` | ✅                         |
| Pagos (×2 tables) | `Tipo \| Monto \| Detalle`                                                                   | ❌ see below               |
| Pendientes        | `Tipo \| Monto \| Detalle`                                                                   | ❌ same signature as Pagos |
| Cobranza          | `Tipo \| Monto Liquidado \| Detalle`                                                         | ✅                         |
| Convenios         | `Tipo \| Liquidado \| Detalle`                                                               | ✅                         |

**The Pagos block is deliberately NOT curated.** It renders as two tables carrying _identical_
headers (one holds Voluntarios / No Voluntarios, the other Renta / Devoluciones / Bonificaciones /
Subvenciones). Telling them apart would be guesswork on a single account's data, and guessing
wrong would mislabel someone's money. It stays out until there is evidence to distinguish them.

### The `tipo` cell

TGR glues the count onto the label, sometimes without a space:

```
"Fiscales 1 deudas"        → { tipo: "Fiscales", cantidad: 1 }
"Vigentes0 vigentes"       → { tipo: "Vigentes", cantidad: 0 }
"Pre-Judicial 1 Cuentas"   → { tipo: "Pre-Judicial", cantidad: 1 }
"Liquidación (Quiebra) 0 Cuentas" → { tipo: "Liquidación (Quiebra)", cantidad: 0 }
```

`parseTipoCell` returns null when a cell carries no count, so non-type rows are skipped rather
than turned into a phantom zero.

### Variable row width

A populated debt row renders **6 cells** (the liquidated total is the 5th); a type with nothing in
it renders **3** (label, message, action). The parser reads the amount **only** at full width —
otherwise it would report a message string like `No tiene Deudas de Contribuciones Vigentes` as a
monto.

## Observed section values (shape only)

- **Deudas** — `Contribuciones` (0) and `Fiscales` (N, with vencidas / no vencidas /
  no liquidables split and a liquidated total).
- **Cobranza** — `Pre-Judicial`, `Cobranza Judicial Deudas Fiscales`,
  `Cobranza Judicial Deudas Territoriales`, `Liquidación (Quiebra)`. **The most consequential
  section**: a non-zero row means TGR has opened proceedings, which the debt listing never says.
- **Convenios** — `Vigentes`, `Caducados`, `Pagados`.

## Failure posture

- `PortalReadError` **only** when the Deudas section is missing — that means the dashboard is not
  what we think it is.
- `cobranza` / `convenios` degrade to empty. They are genuinely optional blocks; their absence is
  not a broken scrape.
- Zero rows everywhere is a legitimate answer, not an error.
- **The dashboard can be read before it renders.** 1 of 7 live reads on 2026-09-26 found no table
  at all. A frame trace showed why: the app first loads
  `CartolaFiscalInterWeb/cartolaFiscal/begin`, titled **"Recaptcha"**, carrying a
  `google.com/recaptcha/api2/anchor` child frame; ~3s later that page forwards itself to
  `consultarDatosCartola`, and only then do the tables render. `fetchCartola` polls the frame
  (local DOM, ~10s, paced) until the Deudas section appears; still empty after that → "no terminó
  de cargar", distinct from the structure-change error.
- ⚠️ **This tool never touches the reCAPTCHA.** It does not click, solve or script it; it only
  waits. If TGR escalates to a visible challenge, the read fails — and must stay failed. Detecting
  that state explicitly (rather than reporting it as slowness) is an open item. `tgr cartola` is
  **experimental** until an ADR settles the headless-user-agent posture (`auth-login.md`).

## Read-only

The dashboard's own action controls include **Pagar en Línea**, **Generar Cupón de Pago Total de
Deudas** and **Generar Cupón de Pago de Deudas**. `fetchCartola` navigates and reads; it clicks
**nothing** (ADR-006 / ADR-011).

## Still open

- [ ] The Pagos / Pendientes split (identical headers — needs a second account or a distinguishing
      attribute).
- [ ] `Ver detalle` on the Cobranza row — a further navigation, not implemented.
- [ ] Detect the reCAPTCHA interstitial / a visible challenge and fail with a distinct message.
- [ ] Known race (code review 2026-09-26): readiness accepts as soon as the Deudas table exists;
      on a document still streaming, Cobranza/Convenios may not be parsed yet and would degrade
      to empty. Fix planned at the adapter level (wait for `readyState !== 'loading'`).
- [ ] Verified against ONE account whose sections are almost entirely zeros. A populated
      cobranza/convenios parse is unverified.
