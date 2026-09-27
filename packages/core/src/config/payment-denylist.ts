// ⛔⛔⛔ TGR PAYMENT SURFACES — ADR-006 ⛔⛔⛔
//
// This module is the ONLY place in the repository allowed to name a TGR payment host.
// `guardrails/no-payment.test.ts` walks every other .ts file under packages/*/src and FAILS THE
// BUILD if any of them contains one of these strings. That is deliberate: TGR is a collections
// agency, and a payment moves real money irreversibly. This tool is read-only BY CONSTRUCTION,
// not by configuration — there is no env var, no flag, and no gated code path that turns payment
// on, because none exists to turn on.
//
// If you are here because you want to add a "read the total due" facade: read it from an APP host
// (config.ts APP_HOSTS). Do not point it at one of these.
//
// Observed 2026-08-10 (read-only GET of the public TGR site):
//   centro-pagos.tgr.cl    — "Pagar Impuestos Fiscales y Aduaneros" / "Pagar cuotas de Convenios"
//   contribuciones.tgr.cl  — "Pagar contribuciones en línea" (/main/contribuciones/conclave)

export const PAYMENT_HOSTS: readonly string[] = ['centro-pagos.tgr.cl', 'contribuciones.tgr.cl'];

/** Form VALUES that select a payment branch inside an embedded TGR app (ADR-011).
 *
 *  `ImpuestosFiscalesWEB` gates its debt listing behind `tipoPago`, and one of the two options is
 *  "Pagar en línea". This project submits the OTHER one and only that one — see
 *  `TIPO_PAGO_COMPROBANTE` in config.ts. The value below is listed here, in the module the
 *  guardrail test exempts, precisely so it can be searched for WITHOUT existing anywhere else in
 *  the tree. If it ever appears in another file, the build fails.
 *
 *  Observed 2026-08-11 on `www.tesoreria.cl/ImpuestosFiscalesWEB/`. */
export const FORBIDDEN_FORM_VALUES: readonly string[] = ['PortalFiscalEnLinea'];

/** Is `url` a TGR payment surface? Used as a runtime tripwire in the portal adapter so that even
 *  a redirect chain cannot land a navigation on a payment page (defence in depth — the static
 *  guardrail test is the primary control). A URL that does not parse is NOT treated as payment:
 *  callers pass URLs they built, and a parse failure is their own error to surface. */
export function isPaymentHost(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return PAYMENT_HOSTS.includes(hostname);
}
