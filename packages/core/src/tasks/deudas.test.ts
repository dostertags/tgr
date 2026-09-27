import { describe, expect, it } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
  type FakeSessionScript,
} from '../adapters/fake/index.js';
import { TIPO_PAGO_COMPROBANTE } from '../config/index.js';
import { NotAuthenticatedError, PortalReadError } from '../errors/index.js';
import type { Runtime } from '../seams/index.js';
import { writeSession } from '../auth/session.js';
import { listDeudasFiscales } from './deudas.js';

const NOW = new Date('2026-08-11T13:00:00.000Z');
const AUTH_LANDING = 'https://web.tesoreria.cl/tramites-tgr/pago-impuestos-fiscales/';
const HEADERS = ['FORMULARIO', 'NRO FOLIO', 'VENCIMIENTO', 'TOTAL A PAGAR'];

/** A fake app that behaves like ImpuestosFiscalesWEB: gated until ACEPTAR is clicked.
 *
 *  `loadingReads` models the frame being findable while its document is still `loading`
 *  (observed 2026-09-26, ~4s): the first N reads see an empty document. */
function gatedApp(
  rows: string[][],
  opts: { gate?: boolean; loadingReads?: number } = {},
): FakeSessionScript {
  let passed = !(opts.gate ?? true);
  let reads = 0;
  return {
    landingUrl: AUTH_LANDING,
    onClickInFrame: (_frame, selector) => {
      if (selector.includes('aceptar')) passed = true;
    },
    evaluateInFrame: (_frame, expression) => {
      if (/no autorizado/i.test(expression)) return false; // openTramite's access check
      reads += 1;
      const loading = reads <= (opts.loadingReads ?? 0);
      if (expression.includes('app-rendered')) return !loading;
      if (loading) return expression.includes('tipoPago') ? false : null;
      if (expression.includes('tipoPago')) return !passed;
      if (expression.includes('querySelector')) {
        return passed ? { headers: HEADERS, rows } : null;
      }
      return null;
    },
  };
}

async function build(script: FakeSessionScript) {
  const runtime: Runtime = {
    clock: new FixedClock(NOW),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver({ restoreSession: script }),
  };
  await writeSession(runtime.store, {
    rut: '77777777-7',
    cookies: { cookies: [] },
    savedAt: NOW.toISOString(),
  });
  return runtime;
}

describe('listDeudasFiscales', () => {
  it('waits for the app document to render before looking (regression)', async () => {
    // Observed 2026-09-26: "No se encontró ni la tabla de deudas ni el formulario de tipo de
    // pago" — the frame was found while its document was still loading.
    const runtime = await build(
      gatedApp([['21', '12345678', '30-04-2026', '123.456']], { loadingReads: 2 }),
    );

    const result = await listDeudasFiscales(runtime);

    expect(result.deudas).toHaveLength(1);
    expect((runtime.clock as FixedClock).slept).toHaveLength(2);
  });

  it('touches nothing and says so when the app never finishes loading', async () => {
    const runtime = await build(gatedApp([], { loadingReads: Number.POSITIVE_INFINITY }));
    const portal = runtime.portal as FakePortalDriver;

    await expect(listDeudasFiscales(runtime)).rejects.toThrow(/no terminó de cargar/);
    expect(portal.sessions.flatMap((s) => s.frameClicks)).toEqual([]);
  });

  it('passes the gate and returns the parsed debts', async () => {
    const runtime = await build(gatedApp([['21', '12345678', '30-04-2026', '123.456']]));

    const result = await listDeudasFiscales(runtime);

    expect(result.deudas).toHaveLength(1);
    expect(result.totalCLP).toBe(123456);
  });

  it('submits ONLY the comprobante option and the ACEPTAR button (ADR-011)', async () => {
    // The honesty check for ADR-011: this asserts the complete set of interactions this tool
    // performs on TGR. If anything else is ever clicked, this test fails.
    const runtime = await build(gatedApp([]));
    const portal = runtime.portal as FakePortalDriver;

    await listDeudasFiscales(runtime);

    const touched = portal.sessions.flatMap((s) => s.frameClicks);
    expect(touched).toHaveLength(2);
    // Selecting the non-payment mode is a local tick; only ACEPTAR submits.
    expect(touched[0]).toMatchObject({ kind: 'check' });
    expect(touched[0]?.selector).toContain(TIPO_PAGO_COMPROBANTE);
    expect(touched[1]).toMatchObject({ kind: 'click' });
    expect(touched[1]?.selector).toContain('aceptar');
  });

  it('reads the rendered listing without touching a leftover form (regression)', async () => {
    // Observed 2026-08-12: after a successful run the tipoPago form is still in the DOM but
    // hidden, and a second run timed out trying to tick it. Looking before touching fixes it —
    // and touching TGR less is the right default anyway (ADR-011).
    const runtime = await build({
      landingUrl: AUTH_LANDING,
      evaluateInFrame: (_f, expression) => {
        if (expression.includes('tipoPago')) return true; // form still present
        if (expression.includes('querySelector')) {
          return { headers: HEADERS, rows: [['21', '1', '30-04-2026', '1.000']] };
        }
        return null;
      },
    });
    const portal = runtime.portal as FakePortalDriver;

    const result = await listDeudasFiscales(runtime);

    expect(result.deudas).toHaveLength(1);
    expect(portal.sessions.flatMap((s) => s.frameClicks)).toHaveLength(0);
  });

  it('does not click anything when the app is already past the gate', async () => {
    const runtime = await build(gatedApp([['21', '1', '30-04-2026', '1.000']], { gate: false }));
    const portal = runtime.portal as FakePortalDriver;

    await listDeudasFiscales(runtime);

    expect(portal.sessions.flatMap((s) => s.frameClicks)).toHaveLength(0);
  });

  it('refuses to submit when the expected option is missing', async () => {
    // TGR renamed the option: click nothing rather than guess which radio is safe.
    const runtime = await build({
      landingUrl: AUTH_LANDING,
      evaluateInFrame: (_f, expression) =>
        expression.includes(TIPO_PAGO_COMPROBANTE) ? false : expression.includes('tipoPago'),
    });
    const portal = runtime.portal as FakePortalDriver;

    await expect(listDeudasFiscales(runtime)).rejects.toThrow(PortalReadError);
    expect(portal.sessions.flatMap((s) => s.frameClicks)).toHaveLength(0);
  });

  it('raises NotAuthenticated when the session no longer lands authenticated', async () => {
    const runtime = await build({ landingUrl: 'https://autentica.tgr.cl/oauth2/authorize-front' });
    await expect(listDeudasFiscales(runtime)).rejects.toThrow(NotAuthenticatedError);
  });

  it('raises NotAuthenticated when there is no local session at all', async () => {
    const runtime: Runtime = {
      clock: new FixedClock(NOW),
      audit: new RecordingAuditSink(),
      store: new InMemoryKeyValueStore(),
      portal: new FakePortalDriver({ restoreSession: gatedApp([]) }),
    };
    await expect(listDeudasFiscales(runtime)).rejects.toThrow(NotAuthenticatedError);
  });

  it('always closes the session', async () => {
    const runtime = await build(gatedApp([]));
    const portal = runtime.portal as FakePortalDriver;
    await listDeudasFiscales(runtime);
    expect(portal.sessions.every((s) => s.closed)).toBe(true);
  });

  it('records a receipt with the count and total, but never the folios', async () => {
    const runtime = await build(gatedApp([['21', '99887766', '30-04-2026', '1.000']]));
    const audit = runtime.audit as RecordingAuditSink;

    await listDeudasFiscales(runtime);

    const entry = audit.entries.at(-1)!;
    expect(entry).toMatchObject({ action: 'deudas_fiscales_list', result: 'ok', count: 1 });
    // A folio plus an amount is the substance of the debt; a receipt proves the read happened.
    expect(JSON.stringify(audit.entries)).not.toContain('99887766');
  });

  it('records a failure receipt and propagates the error verbatim', async () => {
    const runtime = await build({ landingUrl: 'https://autentica.tgr.cl/oauth2/authorize-front' });
    const audit = runtime.audit as RecordingAuditSink;

    await expect(listDeudasFiscales(runtime)).rejects.toThrow();
    expect(audit.entries.at(-1)).toMatchObject({
      action: 'deudas_fiscales_list',
      result: 'failed',
    });
  });
});
