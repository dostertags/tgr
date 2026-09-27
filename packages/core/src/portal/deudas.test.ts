import { describe, expect, it } from 'vitest';
import { PortalReadError } from '../errors/index.js';
import {
  EXPECTED_HEADERS,
  parseDeudasTable,
  parseFechaDdMmYyyy,
  parseMontoCLP,
  type RawTable,
} from './deudas.js';

// SYNTHETIC rows. Shape observed 2026-08-11; values invented.
const HEADERS = [...EXPECTED_HEADERS];
const table = (rows: string[][]): RawTable => ({ headers: HEADERS, rows });

describe('parseMontoCLP', () => {
  it('parses Chilean thousands separators', () => {
    expect(parseMontoCLP('1.234.567')).toBe(1234567);
    expect(parseMontoCLP('123.456')).toBe(123456);
    expect(parseMontoCLP('900')).toBe(900);
  });

  it('tolerates a currency sign and padding', () => {
    expect(parseMontoCLP(' $ 1.000 ')).toBe(1000);
  });

  it('returns null rather than guessing at an unexpected format', () => {
    for (const bad of ['', '-', '1,5', 'N/A', '1.234,50']) {
      expect(parseMontoCLP(bad), bad).toBeNull();
    }
  });
});

describe('parseFechaDdMmYyyy', () => {
  it('converts DD-MM-YYYY to ISO', () => {
    expect(parseFechaDdMmYyyy('31-12-2026')).toBe('2026-12-31');
    expect(parseFechaDdMmYyyy('01-02-2026')).toBe('2026-02-01');
  });

  it('returns null for anything else — never reorders an unknown format', () => {
    for (const bad of ['2026-12-31', '1-2-2026', '31/12/2026', '']) {
      expect(parseFechaDdMmYyyy(bad), bad).toBeNull();
    }
  });
});

describe('parseDeudasTable', () => {
  it('maps the observed columns onto the curated contract', () => {
    const result = parseDeudasTable(table([['21', '12345678', '30-04-2026', '123.456']]));

    expect(result.deudas).toEqual([
      {
        formulario: '21',
        folio: '12345678',
        vencimiento: '2026-04-30',
        vencimientoRaw: '30-04-2026',
        totalAPagar: 123456,
        totalAPagarRaw: '123.456',
      },
    ]);
    expect(result.totalCLP).toBe(123456);
  });

  it('sums several debts', () => {
    const result = parseDeudasTable(
      table([
        ['21', '1', '30-04-2026', '1.000'],
        ['30', '2', '31-05-2026', '2.500'],
      ]),
    );
    expect(result.totalCLP).toBe(3500);
  });

  it('treats an empty table as a legitimate result, not an error', () => {
    // CONVENTIONS: absence is not an error. Zero debts is the best possible answer.
    const result = parseDeudasTable(table([]));
    expect(result.deudas).toEqual([]);
    expect(result.totalCLP).toBe(0);
  });

  it('FAILS LOUD when the columns change', () => {
    // A renamed column must never shift every value one place left and report wrong amounts.
    expect(() =>
      parseDeudasTable({
        headers: ['FORMULARIO', 'NRO FOLIO', 'VENCIMIENTO', 'MONTO'],
        rows: [['21', '1', '30-04-2026', '1.000']],
      }),
    ).toThrow(PortalReadError);
  });

  it('FAILS LOUD when a column is added or removed', () => {
    expect(() => parseDeudasTable({ headers: ['FORMULARIO', 'NRO FOLIO'], rows: [] })).toThrow(
      PortalReadError,
    );
  });

  it('ignores header case and whitespace, which TGR renders inconsistently', () => {
    expect(() =>
      parseDeudasTable({
        headers: [' formulario ', 'Nro  Folio', 'vencimiento', 'Total A Pagar'],
        rows: [],
      }),
    ).not.toThrow();
  });

  it('refuses to report a total when any amount failed to parse', () => {
    // A partial sum presented as "your total debt" would be a lie.
    const result = parseDeudasTable(
      table([
        ['21', '1', '30-04-2026', '1.000'],
        ['30', '2', '31-05-2026', 'ver detalle'],
      ]),
    );
    expect(result.deudas[1]?.totalAPagar).toBeNull();
    expect(result.totalCLP).toBeNull();
  });

  it('keeps the raw rendering alongside every parsed value', () => {
    const result = parseDeudasTable(table([['21', '1', 'sin fecha', '1.000']]));
    expect(result.deudas[0]?.vencimiento).toBeNull();
    expect(result.deudas[0]?.vencimientoRaw).toBe('sin fecha');
  });
});
