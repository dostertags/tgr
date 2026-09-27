import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import {
  formatRut,
  localStatus,
  login,
  logout,
  renderAnatomyReport,
  SESSION_TYPICAL_LIFETIME_MINUTES,
  type Runtime,
} from '@dostertags/tgr-core';
import { emit, err, out, withOutputFlags } from '../io.js';

/** Where `--observe` writes when no path is given. Relative to the CWD, so running it from the
 *  repo drops the capture straight into the (gitignored) contract folder. */
export const DEFAULT_OBSERVE_PATH = path.join('docs', 'tgr-contract', 'auth-login.observed.md');

/** Resolve commander's `--observe [archivo]` value: absent/false → don't observe, bare flag →
 *  the default path, string → that path. Exported so it is unit-tested without a browser. */
export function observePathFrom(value: string | boolean | undefined): string | null {
  if (value === undefined || value === false) return null;
  return value === true ? DEFAULT_OBSERVE_PATH : value;
}

/** Human lines describing a stored session's age. Past the measured lifetime it WARNS, but does
 *  not decide — `auth status` stays a local read, and TGR remains the authority on liveness.
 *  Exported so it is unit-tested without a runtime. */
export function describeSessionAge(ageMinutes: number | null): string[] {
  if (ageMinutes === null) return [];
  const edad =
    ageMinutes < 60
      ? `${ageMinutes} min`
      : ageMinutes < 48 * 60
        ? `${Math.floor(ageMinutes / 60)} h`
        : `${Math.floor(ageMinutes / (24 * 60))} días`;
  const lines = [`Antigüedad: ${edad}.`];
  if (ageMinutes > SESSION_TYPICAL_LIFETIME_MINUTES) {
    lines.push(
      'Las sesiones de la TGR duran alrededor de una hora: probablemente expiró. ' +
        'Si un comando falla, ejecuta `tgr auth login`.',
    );
  }
  return lines;
}

export function registerAuth(program: Command, runtime: Runtime): void {
  const auth = program.command('auth').description('Autenticación y sesión.');

  withOutputFlags(auth.command('login'))
    .description(
      'Inicia sesión en la TGR abriendo tu navegador en la página real. Eliges tú el proveedor ' +
        '(Clave TGR / Clave Tributaria / ClaveÚnica); la clave nunca llega a este proceso.',
    )
    .option(
      '--observe [archivo]',
      'Además captura la ANATOMÍA de la sesión (solo nombres de cookies y de claves de ' +
        `storage) y la escribe en un archivo (por defecto ${DEFAULT_OBSERVE_PATH}).`,
    )
    .action(async (opts: { observe?: string | boolean }) => {
      const observePath = observePathFrom(opts.observe);
      const result = await login(runtime, { observe: observePath !== null });

      if (observePath !== null && result.anatomy) {
        const report = renderAnatomyReport(result.anatomy, {
          capturedAt: runtime.clock.now().toISOString(),
          restoredFromCookiesOnly: result.restoredFromCookiesOnly,
        });
        await mkdir(path.dirname(path.resolve(observePath)), { recursive: true });
        await writeFile(path.resolve(observePath), report, 'utf8');
        // STDERR: a diagnostic, so STDOUT stays pure JSON.
        err(`Anatomía de sesión escrita en ${observePath} (solo nombres — ADR-009).`);
      }

      emit(result, () => {
        out(
          result.reason === 'already_authenticated'
            ? 'Ya tenías una sesión activa (las cookies guardadas siguen vivas).'
            : 'Sesión iniciada.',
        );
        if (result.rut === null) {
          out('No se pudo leer la identidad desde el portal (la sesión sigue siendo válida).');
        } else {
          const quien = result.razonSocial ? ` — ${result.razonSocial}` : '';
          out(`Operando como ${formatRut(result.rut)}${quien}.`);
        }
        if (result.idp) out(`Autenticado vía ${result.idp}.`);
      });
    });

  withOutputFlags(auth.command('status'))
    .description('Muestra la sesión local (NO consulta a la TGR).')
    .action(async () => {
      const result = await localStatus(runtime);
      emit(result, () => {
        if (!result.authenticated) {
          out('Sin sesión local. Ejecuta `tgr auth login`.');
          return;
        }
        out(`Sesión local guardada el ${result.savedAt}.`);
        for (const line of describeSessionAge(result.ageMinutes)) out(line);
        out(
          result.rut === null
            ? 'Principal: desconocido (la identidad no se pudo leer al iniciar sesión).'
            : `Principal: ${formatRut(result.rut)}${result.razonSocial ? ` — ${result.razonSocial}` : ''}.`,
        );
        if (result.idp) out(`Autenticado vía ${result.idp}.`);
        out('(Lectura local: no prueba que la sesión siga viva en la TGR.)');
      });
    });

  withOutputFlags(auth.command('logout'))
    .description('Borra el estado local de sesión.')
    .action(async () => {
      const result = await logout(runtime);
      emit(result, () => {
        out(result.loggedOut ? 'Estado local borrado.' : 'No había sesión local que borrar.');
        // Say the quiet part out loud rather than implying a clean sign-out.
        out(
          'Nota: no se cerró la sesión del lado de la TGR — todavía no se identifica un ' +
            'endpoint de logout (docs/tgr-contract/auth-login.md).',
        );
      });
    });
}
