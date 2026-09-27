import { Rut } from '../rut/index.js';

/** Human-facing RUT rendering for CLI output. Falls back to the raw input when it is not a
 *  valid RUT (or is null): a display helper must never throw and never hide what it was given. */
export function formatRut(rut: string | null): string {
  if (rut === null) return '(desconocido)';
  return Rut.tryParse(rut)?.formatted ?? rut;
}
