import { describe, expect, it } from 'vitest';
import { FakePortalSession, FixedClock } from '../adapters/fake/index.js';
import { PortalReadError } from '../errors/index.js';
import { fetchCartola, parseCartola, parseTipoCell, type CartolaTable } from './cartola.js';

// Shapes observed 2026-08-12; amounts synthetic.
const DEUDAS: CartolaTable = [
  ['Tipo', 'Vencidas 1', 'No Vencidas 0', 'No Liquidables 0', 'Monto Liquidado', '¿Qué acción?'],
  ['Contribuciones 0 deudas', 'No tiene Deudas de Contribuciones Vigentes', 'Certificado'],
  [
    'Fiscales 1 deudas',
    '$ 123.456 1 deudas',
    '$ 0 0 deudas',
    '$ 0 0 deudas',
    '$ 123.456',
    'acciones',
  ],
];
const COBRANZA: CartolaTable = [
  ['Tipo', 'Monto Liquidado', 'Detalle'],
  ['Pre-Judicial 1 Cuentas', '$ 123.456', 'Ver detalle'],
  ['Cobranza Judicial Deudas Fiscales 0 Cuentas', 'No tiene cuentas en estado Judicial.', ''],
];
const CONVENIOS: CartolaTable = [
  ['Tipo', 'Liquidado', 'Detalle'],
  ['Vigentes0 vigentes', 'No posees Convenios Vigentes', 'N/A'],
  ['Caducados0 caducados', 'No posees Convenios Caducados', 'N/A'],
];
// Two tables share these headers, which is why the pagos block is not curated.
const PAGOS: CartolaTable = [
  ['Tipo', 'Monto', 'Detalle'],
  ['Voluntarios help Son pagos... 5', '$ 9.999.999', 'Revisar pagos'],
];

describe('parseTipoCell', () => {
  it('splits label from count, with or without a space', () => {
    expect(parseTipoCell('Fiscales 1 deudas')).toEqual({ tipo: 'Fiscales', cantidad: 1 });
    expect(parseTipoCell('Vigentes0 vigentes')).toEqual({ tipo: 'Vigentes', cantidad: 0 });
    expect(parseTipoCell('Pre-Judicial 1 Cuentas')).toEqual({ tipo: 'Pre-Judicial', cantidad: 1 });
  });

  it('keeps multi-word labels intact', () => {
    expect(parseTipoCell('Cobranza Judicial Deudas Fiscales 0 Cuentas')).toEqual({
      tipo: 'Cobranza Judicial Deudas Fiscales',
      cantidad: 0,
    });
    expect(parseTipoCell('Liquidación (Quiebra) 0 Cuentas')).toEqual({
      tipo: 'Liquidación (Quiebra)',
      cantidad: 0,
    });
  });

  it('returns null when the cell carries no count, rather than inventing a zero', () => {
    for (const bad of ['', 'Tipo', 'Ver detalle', 'No tiene Deudas']) {
      expect(parseTipoCell(bad), bad).toBeNull();
    }
  });
});

describe('parseCartola', () => {
  const result = parseCartola([DEUDAS, PAGOS, COBRANZA, CONVENIOS]);

  it('reads debts by type with the liquidated amount', () => {
    expect(result.deudas).toEqual([
      { tipo: 'Contribuciones', cantidad: 0, monto: null, montoRaw: null },
      { tipo: 'Fiscales', cantidad: 1, monto: 123456, montoRaw: '$ 123.456' },
    ]);
  });

  it('reads the collection state — the fact the debt listing never tells you', () => {
    expect(result.cobranza[0]).toEqual({
      tipo: 'Pre-Judicial',
      cantidad: 1,
      monto: 123456,
      montoRaw: '$ 123.456',
    });
    expect(result.cobranza[1]?.cantidad).toBe(0);
  });

  it('reads convenios by state', () => {
    expect(result.convenios.map((f) => f.tipo)).toEqual(['Vigentes', 'Caducados']);
    expect(result.convenios.every((f) => f.cantidad === 0)).toBe(true);
  });

  it('does not read an amount from a row that renders fewer cells', () => {
    // An empty type renders 3 cells, so index 4 does not exist — reading "whatever is there"
    // would report a message string as a monto.
    expect(result.deudas[0]?.monto).toBeNull();
    expect(result.deudas[0]?.montoRaw).toBeNull();
  });

  it('identifies sections by header signature, not by position', () => {
    const shuffled = parseCartola([CONVENIOS, COBRANZA, PAGOS, DEUDAS]);
    expect(shuffled).toEqual(result);
  });

  it('FAILS LOUD when the debts section is absent', () => {
    expect(() => parseCartola([PAGOS, CONVENIOS])).toThrow(PortalReadError);
  });

  it('degrades to empty when the optional sections are absent', () => {
    // cobranza/convenios are genuinely optional blocks; their absence is not a broken scrape.
    const only = parseCartola([DEUDAS]);
    expect(only.deudas).toHaveLength(2);
    expect(only.cobranza).toEqual([]);
    expect(only.convenios).toEqual([]);
  });

  it('skips rows that are not type rows', () => {
    const noisy: CartolaTable = [...DEUDAS, ['Consultar Otros Pagos'], ['']];
    expect(parseCartola([noisy]).deudas).toHaveLength(2);
  });
});

describe('fetchCartola — waiting for the embedded app to render', () => {
  const NOW = new Date('2026-09-26T12:00:00.000Z');
  // openTramite's access check and the scrape both go through evaluateInFrame; tell them apart.
  const isAccessCheck = (expression: string) => /no autorizado/i.test(expression);

  /** Successive scrape results, one per read; the last one repeats. A thrown Error simulates a
   *  frame whose document is being replaced mid-read. */
  function sessionFor(reads: readonly (readonly CartolaTable[] | Error)[]) {
    let i = 0;
    return new FakePortalSession({
      evaluateInFrame: (_frame, expression) => {
        if (isAccessCheck(expression)) return false;
        const next = reads[Math.min(i++, reads.length - 1)];
        if (next instanceof Error) throw next;
        return next;
      },
    });
  }
  const scrapes = (s: FakePortalSession) =>
    s.frameEvaluations.filter((e) => !isAccessCheck(e.expression)).length;

  it('reads the dashboard once it renders, instead of failing on a loading document (regression)', async () => {
    // Observed 2026-09-26: 1 of 7 live runs failed with "No se encontró ninguna tabla" — the
    // frame was found by URL before its document had rendered any table.
    const session = sessionFor([[], [], [DEUDAS, COBRANZA, CONVENIOS]]);

    const result = await fetchCartola(session, new FixedClock(NOW));

    expect(result.deudas).toHaveLength(2);
    expect(scrapes(session)).toBe(3);
  });

  it('paces its DOM reads through the clock', async () => {
    const session = sessionFor([[], [], [DEUDAS]]);
    const clock = new FixedClock(NOW);

    await fetchCartola(session, clock);

    expect(clock.slept).toHaveLength(2);
    expect(clock.slept.every((ms) => ms > 0)).toBe(true);
  });

  it('never re-navigates while waiting — re-reading the local DOM is not a retry', async () => {
    const session = sessionFor([[], [], [DEUDAS]]);

    await fetchCartola(session, new FixedClock(NOW));

    expect(session.gotos).toHaveLength(1);
  });

  it('treats a read that throws mid-navigation as "not rendered yet"', async () => {
    const session = sessionFor([new Error('Execution context was destroyed'), [DEUDAS]]);

    await expect(fetchCartola(session, new FixedClock(NOW))).resolves.toMatchObject({
      deudas: expect.any(Array),
    });
  });

  it('is bounded, and says the app did not finish loading — not that the page changed', async () => {
    const session = sessionFor([[]]);

    const failure = fetchCartola(session, new FixedClock(NOW));

    await expect(failure).rejects.toThrow(PortalReadError);
    await expect(failure).rejects.toThrow(/no terminó de cargar/);
    expect(scrapes(session)).toBeLessThanOrEqual(30);
  });

  it('does not swallow a missing app frame — that one is a real structure change', async () => {
    const session = sessionFor([new PortalReadError('No se encontró la aplicación embebida')]);

    await expect(fetchCartola(session, new FixedClock(NOW))).rejects.toThrow(
      /No se encontró la aplicación embebida/,
    );
    expect(scrapes(session)).toBe(1);
  });

  it('still fails loud when tables render but the debts section is gone', async () => {
    const session = sessionFor([[PAGOS]]);

    await expect(fetchCartola(session, new FixedClock(NOW))).rejects.toThrow(
      /cambió de estructura/,
    );
  });
});
