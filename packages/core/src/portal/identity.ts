// Identity of the session principal (ADR-008 / ADR-010), read from the AUTHENTICATED site.
//
// TGR has no `DatosCntrNow` equivalent. What it does have, on the authenticated cartola page, is a
// hand-off link into the cartola application that carries the principal's identity in its own
// query string. Observed 2026-08-10:
//
//   https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/
//     ?go=https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=<BASE64>
//     &no=<razón+social>
//     &ap=
//
// `vr` base64-decodes to SIX comma-separated fields (values redacted):
//
//   0  <32-char opaque token>
//   1  2026-08-10T19:55:23Z          ← issued-at; the hand-off is time-bound
//   2  <RUT body>
//   3  <32-char signature>
//   4  /CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=<body>&DV=<dv>
//   5  ClaveTributaria               ← which IdP authenticated this session
//
// The parsing is PURE and unit-tested against synthetic values; the facade below only supplies it
// with hrefs. Fields 0/3 are opaque and are never read, stored, or logged.
import { RUT_HANDOFF_PATH } from '../config/index.js';
import { Rut } from '../rut/index.js';
import type { PortalSession } from '../seams/index.js';

export interface TgrIdentity {
  /** Canonical `<body>-<DV>`, validated Mod-11. Asserted by the portal, never by the caller. */
  readonly rut: string;
  /** Razón social (empresa) or full name (persona) as TGR renders it. PII. */
  readonly razonSocial: string | null;
  /** Which IdP authenticated this session (`ClaveTributaria` | `ClaveUnica` | `ClaveTesoreria`). */
  readonly idp: string | null;
}

/** Extract the identity from one hand-off href, or null if this href is not one.
 *
 *  Deliberately total: any malformed / unexpected shape returns null rather than throwing, so a
 *  page-structure change degrades a login to "identity unknown" instead of breaking it. */
export function parseIdentityFromHandoffLink(href: string): TgrIdentity | null {
  let outer: URL;
  try {
    outer = new URL(href);
  } catch {
    return null;
  }

  const go = outer.searchParams.get('go');
  if (!go || !go.includes(RUT_HANDOFF_PATH)) return null;

  // `go` is itself a URL carrying `?vr=<base64>`. Parsing it as a URL is fine — the outer
  // URLSearchParams already split on `&`, so `go` ends at the base64 value.
  const vrIndex = go.indexOf('vr=');
  if (vrIndex === -1) return null;
  const vr = go.slice(vrIndex + 3);

  let decoded: string;
  try {
    decoded = Buffer.from(vr, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const fields = decoded.split(',');
  // Field 4 holds the target path with RUT + DV; field 2 repeats the body. Read the DV from
  // field 4 and cross-check the body against field 2 — if TGR ever changes the layout, a
  // mismatch must fail closed rather than yield a confidently wrong RUT.
  const body = fields[2];
  const target = fields[4];
  if (!body || !target) return null;

  const dv = /[?&]DV=([0-9kK])\b/.exec(target)?.[1];
  const targetBody = /[?&]RUT=(\d+)\b/.exec(target)?.[1];
  if (!dv || !targetBody || targetBody !== body.trim()) return null;

  const rut = Rut.tryParse(`${body.trim()}-${dv}`);
  if (!rut) return null;

  const razonSocial = outer.searchParams.get('no')?.trim() || null;
  const idp = fields[5]?.trim() || null;

  return { rut: rut.canonical, razonSocial, idp };
}

/** Read the principal's identity from the CURRENT page. The caller must already be on the
 *  authenticated cartola page (`SESSION_PROBE_URL`, settled) — this does not navigate.
 *
 *  Returns null when no hand-off link is present, which is the honest answer for "we could not
 *  determine it" and is exactly what a caller should record rather than inventing a RUT. */
export async function readIdentity(session: PortalSession): Promise<TgrIdentity | null> {
  const hrefs = await session.evaluate<string[] | null>(
    `Array.from(document.querySelectorAll('a')).map(a => a.href)`,
  );
  for (const href of hrefs ?? []) {
    const identity = parseIdentityFromHandoffLink(href);
    if (identity) return identity;
  }
  return null;
}
