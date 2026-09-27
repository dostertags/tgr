// Deudas de Impuestos Fiscales y Aduaneros — the read half of the DIN surface (ADR-011).
//
// TGR serves this as a WordPress shell (`TRAMITES.deudasFiscales`) embedding the Java app
// `ImpuestosFiscalesWEB` in an iframe. The app refuses to list anything until `tipoPago` is
// chosen, so this facade submits the ONE sanctioned non-payment value and stops at the listing.
// It never generates a cupón and never touches the payment branch.
//
// Observed 2026-08-11 — see docs/tgr-contract/deudas-fiscales.md:
//   POST /ImpuestosFiscalesWEB/consultaDeudasFiscales
//   table#example.dataTable → FORMULARIO | NRO FOLIO | VENCIMIENTO | TOTAL A PAGAR
import { EMBEDDED_APPS, TIPO_PAGO_COMPROBANTE, TRAMITES } from '../config/index.js';
import { PortalReadError } from '../errors/index.js';
import type { Clock, PortalSession } from '../seams/index.js';
import { openTramite, readFrameWhenReady } from './tramite.js';

export interface DeudaFiscal {
  /** Form code TGR assigns to the charge type (e.g. the aduanero/DIN-derived forms). */
  readonly formulario: string;
  readonly folio: string;
  /** ISO `YYYY-MM-DD`, or null when the rendered date was not `DD-MM-YYYY`. */
  readonly vencimiento: string | null;
  /** The date exactly as TGR rendered it — kept so a caller can always see the source. */
  readonly vencimientoRaw: string;
  /** CLP as an integer, or null when the rendered amount was not parseable. */
  readonly totalAPagar: number | null;
  readonly totalAPagarRaw: string;
}

export interface DeudasFiscales {
  readonly deudas: readonly DeudaFiscal[];
  /** Sum of the parsed amounts. Null if ANY row failed to parse — a partial total is a lie. */
  readonly totalCLP: number | null;
}

/** The column headers this parser understands. A change here is a broken scraper, not a new
 *  feature: TGR renaming a column must fail loudly rather than shift every value one place left. */
export const EXPECTED_HEADERS = [
  'FORMULARIO',
  'NRO FOLIO',
  'VENCIMIENTO',
  'TOTAL A PAGAR',
] as const;

/** Raw table as scraped from the DOM: header labels plus row cell text. */
export interface RawTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** `1.234.567` → `1234567`. Chilean formatting uses `.` as the thousands separator and has no
 *  decimals for CLP. Anything else yields null rather than a guess. */
export function parseMontoCLP(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, '').replace(/\./g, '').replace(/\s/g, '').trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** `31-12-2026` → `2026-12-31`. Returns null for any other shape. */
export function parseFechaDdMmYyyy(raw: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Map the scraped table onto the curated contract. PURE — unit tested without a browser.
 *
 *  Raises `PortalReadError` if the headers are not the observed ones (CONVENTIONS: fail loud when
 *  a scraper breaks). An EMPTY table is NOT an error — no debts is a legitimate answer. */
export function parseDeudasTable(table: RawTable): DeudasFiscales {
  const got = table.headers.map(normalise);
  const want = EXPECTED_HEADERS.map(normalise);
  const headersMatch = got.length === want.length && want.every((h, i) => got[i] === h);
  if (!headersMatch) {
    throw new PortalReadError(
      'La tabla de deudas fiscales cambió de estructura. ' +
        `Esperado: [${EXPECTED_HEADERS.join(' | ')}]. Recibido: [${table.headers.join(' | ')}]. ` +
        'No se interpretó nada para no informar montos equivocados.',
    );
  }

  const deudas: DeudaFiscal[] = table.rows
    // DataTables renders a single placeholder row when there is nothing to show.
    .filter((cells) => cells.length === want.length)
    .map((cells) => {
      const [formulario = '', folio = '', vencimientoRaw = '', totalAPagarRaw = ''] = cells;
      return {
        formulario: formulario.trim(),
        folio: folio.trim(),
        vencimiento: parseFechaDdMmYyyy(vencimientoRaw),
        vencimientoRaw: vencimientoRaw.trim(),
        totalAPagar: parseMontoCLP(totalAPagarRaw),
        totalAPagarRaw: totalAPagarRaw.trim(),
      };
    });

  const anyUnparsed = deudas.some((d) => d.totalAPagar === null);
  const totalCLP = anyUnparsed ? null : deudas.reduce((sum, d) => sum + (d.totalAPagar ?? 0), 0);

  return { deudas, totalCLP };
}

// Scrapes the rendered DataTables grid. Kept as a string expression so the DOM never enters the
// core — the adapter evaluates it inside the app frame and hands back plain arrays.
const SCRAPE_TABLE = `
  (() => {
    const t = document.querySelector('table');
    if (!t) return null;
    return {
      headers: Array.from(t.querySelectorAll('thead th, th')).map(x => x.textContent.trim()),
      rows: Array.from(t.querySelectorAll('tbody tr'))
        .map(tr => Array.from(tr.cells).map(c => c.textContent.trim()))
    };
  })()
`;

// Is the gate ACTIONABLE? Presence is not enough: once the listing has rendered, the form is
// still in the DOM but hidden, and ticking a hidden radio just times out (observed 2026-08-12 —
// a second consecutive run failed this way). `getClientRects()` is empty for anything not laid
// out, which is exactly the distinction that matters here.
const GATE_ACTIONABLE = `
  (() => {
    const el = document.querySelector('input[name=tipoPago][value="${TIPO_PAGO_COMPROBANTE}"]');
    return !!el && el.getClientRects().length > 0;
  })()
`;

const ANY_GATE_PRESENT = `!!document.querySelector('input[name=tipoPago]')`;

// Has the app's document rendered EITHER of the two things this read can act on? The frame is
// findable by URL while its document is still loading (observed 2026-09-26, ~4s), and looking at
// that moment finds neither and reports a structure change. The marker comment is inert.
const APP_RENDERED = `/* app-rendered */ !!(
  document.querySelector('table') || document.querySelector('input[name=tipoPago]')
)`;

/** Do these headers look like the deudas grid? A SOFT check — unlike `parseDeudasTable` it never
 *  throws, because it is used to decide whether we are already past the gate. */
function isDeudasTable(table: RawTable | null): table is RawTable {
  if (!table) return false;
  const got = table.headers.map(normalise);
  const want = EXPECTED_HEADERS.map(normalise);
  return got.length === want.length && want.every((h, i) => got[i] === h);
}

/** Fetch the fiscal + aduanero debt listing (ADR-011).
 *
 *  Flow: open the trámite shell → assert the non-payment option exists → select it → ACEPTAR →
 *  scrape the listing. The assertion matters: if TGR renames the option we refuse to click
 *  anything rather than risk selecting whatever else is on the form. */
export async function fetchDeudasFiscales(
  session: PortalSession,
  clock: Clock,
): Promise<DeudasFiscales> {
  const app = EMBEDDED_APPS.impuestosFiscales;
  // `openTramite` handles the bootstrap some embedded apps need. This one has never required it,
  // but going through the same door keeps every read surface identical — and if TGR changes its
  // mind, the read keeps working instead of failing mysteriously.
  // `openTramite` asserts the session is still good before anything else, so an expired jar
  // surfaces as NotAuthenticated rather than as a phantom scraper failure.
  await openTramite(session, clock, TRAMITES.deudasFiscales, app);

  const { ready } = await readFrameWhenReady<boolean>(session, clock, app, APP_RENDERED, (r) => r);
  if (!ready) {
    throw new PortalReadError(
      'La aplicación de Impuestos Fiscales no terminó de cargar. TGR puede estar lento: vuelve ' +
        'a intentarlo en unos minutos. No se envió nada.',
    );
  }

  // Look BEFORE touching anything: on a warm app session the listing is already rendered, and the
  // fewer interactions this tool performs on TGR the better (ADR-011).
  const alreadyListed = await session.evaluateInFrame<RawTable | null>(app, SCRAPE_TABLE);
  if (isDeudasTable(alreadyListed)) return parseDeudasTable(alreadyListed);

  if (!(await session.evaluateInFrame<boolean>(app, GATE_ACTIONABLE))) {
    const gateExists = await session.evaluateInFrame<boolean>(app, ANY_GATE_PRESENT);
    throw new PortalReadError(
      gateExists
        ? 'El formulario de tipo de pago cambió: no está utilizable la opción de comprobante ' +
            'que esta herramienta tiene permitido enviar (ADR-011). No se envió nada.'
        : 'No se encontró ni la tabla de deudas ni el formulario de tipo de pago. ' +
            'La aplicación de Impuestos Fiscales cambió de estructura.',
    );
  }

  await session.checkInFrame(app, `input[name=tipoPago][value="${TIPO_PAGO_COMPROBANTE}"]`);
  await session.clickInFrame(app, '#aceptar');

  const table = await session.evaluateInFrame<RawTable | null>(app, SCRAPE_TABLE);
  if (!table) {
    throw new PortalReadError(
      'No se encontró la tabla de deudas en la aplicación de Impuestos Fiscales. ' +
        'La página cambió de estructura.',
    );
  }
  return parseDeudasTable(table);
}
