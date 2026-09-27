// Cartola Fiscal — the 12-month summary of the principal's situation at TGR (ADR-011).
//
// Reached like every other embedded app: navigate the WordPress shell, let the iframe render,
// read inside it. `CartolaFiscalInterWeb` is the app that NEEDS the bootstrap (see tramite.ts).
//
// Observed 2026-08-12 — see docs/tgr-contract/cartola-fiscal.md. The dashboard is built from
// LAYOUT tables: no `<th>`, row 0 carries the headers, and a row's cell count varies with whether
// that type has anything in it. Sections are therefore identified by their header signature, not
// by position.
import { EMBEDDED_APPS, TRAMITES } from '../config/index.js';
import { PortalReadError } from '../errors/index.js';
import type { Clock, PortalSession } from '../seams/index.js';
import { parseMontoCLP } from './deudas.js';
import { openTramite, readFrameWhenReady } from './tramite.js';

export interface CartolaFila {
  /** e.g. `Fiscales`, `Contribuciones`, `Pre-Judicial`, `Vigentes`. */
  readonly tipo: string;
  /** How many items of this type. `0` is the common, legitimate answer. */
  readonly cantidad: number;
  /** CLP, or null when the row carries no amount (typical for an empty type). */
  readonly monto: number | null;
  /** The amount exactly as TGR rendered it, or null. */
  readonly montoRaw: string | null;
}

export interface CartolaResumen {
  /** Debts by type, with the LIQUIDATED amount TGR shows for each. */
  readonly deudas: readonly CartolaFila[];
  /** Collection state — pre-judicial, judicial, liquidación. The most consequential section:
   *  a non-zero row here means TGR has started proceedings, which the debt listing never says. */
  readonly cobranza: readonly CartolaFila[];
  /** Payment agreements by state (vigentes / caducados / pagados). */
  readonly convenios: readonly CartolaFila[];
}

/** Split a cartola "tipo" cell into its label and count.
 *
 *  TGR renders these as one blob with the count glued on, sometimes without a space:
 *  `Fiscales 1 deudas`, `Pre-Judicial 1 Cuentas`, `Vigentes0 vigentes`. Returns null when the
 *  cell does not carry a count, so a caller can skip a row rather than invent a zero. */
export function parseTipoCell(cell: string): { tipo: string; cantidad: number } | null {
  const m = /^(.*?)\s*(\d+)\s*(?:deudas?|cuentas?|vigentes?|caducados?|pagados?)\s*$/i.exec(
    cell.replace(/\s+/g, ' ').trim(),
  );
  if (!m) return null;
  const tipo = (m[1] ?? '').trim();
  const cantidad = Number(m[2]);
  if (!tipo || !Number.isFinite(cantidad)) return null;
  return { tipo, cantidad };
}

/** A table as scraped: every row, every cell, text only. */
export type CartolaTable = readonly (readonly string[])[];

function headerOf(table: CartolaTable): string[] {
  return (table[0] ?? []).map((c) => c.replace(/\s+/g, ' ').trim().toLowerCase());
}

function findSection(tables: readonly CartolaTable[], test: (headers: string[]) => boolean) {
  return tables.find((t) => test(headerOf(t)));
}

/** Turn a section's rows into typed rows. `montoAt` is the cell index holding the amount for a
 *  POPULATED row; rows shaped differently (an empty type renders fewer cells) yield a null amount
 *  rather than reading whatever happens to sit at that index. */
function rowsOf(
  table: CartolaTable | undefined,
  montoAt: number,
  fullWidth: number,
): CartolaFila[] {
  if (!table) return [];
  const out: CartolaFila[] = [];
  for (const cells of table.slice(1)) {
    const parsed = parseTipoCell(cells[0] ?? '');
    if (!parsed) continue;
    const raw = cells.length >= fullWidth ? (cells[montoAt] ?? null) : null;
    out.push({
      tipo: parsed.tipo,
      cantidad: parsed.cantidad,
      monto: raw === null ? null : parseMontoCLP(raw),
      montoRaw: raw,
    });
  }
  return out;
}

const isDeudasHeader = (h: string[]) => h.some((c) => /no vencidas/.test(c));

function hasDeudasSection(tables: readonly CartolaTable[]): boolean {
  return findSection(tables, isDeudasHeader) !== undefined;
}

/** Map the scraped dashboard onto the curated contract. PURE — unit tested without a browser.
 *
 *  Raises `PortalReadError` only when the DEBTS section is missing, which means the dashboard is
 *  not what we think it is. `cobranza` and `convenios` degrade to empty: they are genuinely
 *  optional blocks, and an account without them is not a broken scrape.
 *
 *  The PAGOS block is deliberately NOT curated: it renders as two tables with identical headers
 *  (`Tipo | Monto | Detalle`), so telling them apart would be guesswork on one account's data. */
export function parseCartola(tables: readonly CartolaTable[]): CartolaResumen {
  const deudasTable = findSection(tables, isDeudasHeader);
  if (!deudasTable) {
    throw new PortalReadError(
      'La cartola no expone la sección de deudas esperada. El tablero cambió de estructura; ' +
        'no se interpretó nada.',
    );
  }
  const cobranzaTable = findSection(tables, (h) => h[1] === 'monto liquidado' && h.length === 3);
  const conveniosTable = findSection(tables, (h) => h[1] === 'liquidado' && h.length === 3);

  return {
    // Populated debt rows render 6 cells; the liquidated total sits in the 5th.
    deudas: rowsOf(deudasTable, 4, 6),
    cobranza: rowsOf(cobranzaTable, 1, 3),
    convenios: rowsOf(conveniosTable, 1, 3),
  };
}

// Scrapes every layout table, cells as text. Kept as a string expression so no DOM enters core.
const SCRAPE_TABLES = `
  Array.from(document.querySelectorAll('table')).map(t =>
    Array.from(t.rows).map(r =>
      Array.from(r.cells).map(c => (c.textContent || '').replace(/\\s+/g, ' ').trim())
    )
  ).filter(rows => rows.length > 1)
`;

/** Fetch the cartola summary. Read-only: this navigates and reads, and clicks nothing — the
 *  dashboard's own action buttons include "Pagar en Línea" and "Generar Cupón", which this tool
 *  must never touch (ADR-006 / ADR-011). */
export async function fetchCartola(session: PortalSession, clock: Clock): Promise<CartolaResumen> {
  const app = EMBEDDED_APPS.cartolaFiscal;
  await openTramite(session, clock, TRAMITES.cartolaFiscal, app);
  // Ready = the debts section has rendered; it is the one section parseCartola requires.
  const { ready, value: tables } = await readFrameWhenReady<CartolaTable[] | null>(
    session,
    clock,
    app,
    SCRAPE_TABLES,
    (t) => t !== null && hasDeudasSection(t),
  );
  if (!ready && (!tables || tables.length === 0)) {
    throw new PortalReadError(
      'La Cartola Fiscal no terminó de cargar (ninguna tabla tras esperar). TGR puede estar ' +
        'lento: vuelve a intentarlo en unos minutos. No se interpretó nada.',
    );
  }
  // Rendered but unrecognised → parseCartola raises the structure-change error (fail loud).
  return parseCartola(tables ?? []);
}
