// Session-anatomy rendering (ADR-009). PURE — no browser, no fs — so it is unit-tested without
// either. The adapter produces the `SessionAnatomy`; the CLI writes the string this returns.
import type { SessionAnatomy } from '../seams/index.js';

/** Strip everything after the path. TGR's login is an OAuth authorization-code flow, so a raw
 *  terminal URL can carry `?code=<live credential>` (and `state`). The adapter calls this BEFORE
 *  the URL enters a `SessionAnatomy`, so the code never reaches memory we might render or log.
 *  An unparseable input is returned as the literal `(url ilegible)` rather than passed through —
 *  echoing something we could not parse is exactly how a secret leaks. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(url ilegible)';
  }
}

function bullets(items: readonly string[]): string {
  return items.length === 0 ? '  _(ninguna)_\n' : items.map((i) => `  - \`${i}\`\n`).join('');
}

export interface AnatomyReportMeta {
  /** ISO timestamp from the injected clock — never `new Date()` at the call site. */
  readonly capturedAt: string;
  /** Whether the cookies-only jar was proven to restore a session, if known. */
  readonly restoredFromCookiesOnly?: boolean | undefined;
}

/** Render the observed session anatomy as markdown, ready to be curated into
 *  docs/tgr-contract/auth-login.md. Names only — this function is never given values, and the
 *  header says so loudly so a reader knows what the file is and is not. */
export function renderAnatomyReport(anatomy: SessionAnatomy, meta: AnatomyReportMeta): string {
  const domains = Object.keys(anatomy.cookieNamesByDomain).sort();
  const origins = Object.keys(anatomy.storageKeyNamesByOrigin).sort();

  const lines: string[] = [
    '# Captura de anatomía de sesión — TGR',
    '',
    `Capturada: ${meta.capturedAt}`,
    '',
    '> **Solo NOMBRES.** Esta captura no contiene valores de cookies, tokens ni claves, y la URL',
    '> de aterrizaje viene sin query ni hash (el flujo OAuth lleva un `code` de un solo uso).',
    '> Aun así es salida CRUDA de una sesión real: está en `.gitignore`. Solo un resumen revisado',
    '> por una persona entra a `docs/tgr-contract/auth-login.md` (ADR-009).',
    '',
    '## Aterrizaje',
    '',
    `- URL terminal (redactada): \`${anatomy.landedUrl}\``,
  ];

  if (meta.restoredFromCookiesOnly !== undefined) {
    lines.push(
      `- ¿La sesión cookies-only revivió? **${meta.restoredFromCookiesOnly ? 'SÍ' : 'NO'}** ` +
        '— responde la pregunta abierta de ADR-005.',
    );
  }

  lines.push('', '## Cookies por dominio (nombres)', '');
  if (domains.length === 0) {
    lines.push('_(ninguna)_', '');
  } else {
    for (const d of domains) {
      lines.push(`### \`${d}\``, '', bullets(anatomy.cookieNamesByDomain[d] ?? []));
    }
  }

  lines.push('## Storage por origen (nombres de claves)', '');
  if (origins.length === 0) {
    lines.push('_(ninguno)_', '');
  } else {
    for (const o of origins) {
      const entry = anatomy.storageKeyNamesByOrigin[o];
      lines.push(
        `### \`${o}\``,
        '',
        '**localStorage**',
        '',
        bullets(entry?.localStorage ?? []),
        '**sessionStorage** _(solo observable en el origen actual de la página)_',
        '',
        bullets(entry?.sessionStorage ?? []),
      );
    }
  }

  lines.push(
    '## Qué mirar',
    '',
    '- ¿Hay claves `CognitoIdentityServiceProvider.*`? Si sí, la sesión vive en `localStorage`',
    '  y cookies-only NO alcanza → escalar a allowlist de claves (ADR-005).',
    '- ¿En cuántos dominios registrables hay cookies? (`tgr.cl`, `tgr.gob.cl`, `tesoreria.cl`)',
    '- ¿Aparece algo que se parezca a un RUT o a un `id_token`? Es el candidato de ADR-008.',
    '',
  );

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
