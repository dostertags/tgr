import type { Command } from 'commander';
import { readCartola, type CartolaFila, type Runtime } from '@dostertags/tgr-core';
import { emit, out, withOutputFlags } from '../io.js';

function clp(n: number | null): string {
  return n === null ? '—' : `$${n.toLocaleString('es-CL')}`;
}

function section(title: string, filas: readonly CartolaFila[]): void {
  out('');
  out(title);
  if (filas.length === 0) {
    out('  (sin datos)');
    return;
  }
  for (const f of filas) {
    out(`  ${f.tipo}: ${f.cantidad}${f.monto !== null ? ` · ${clp(f.monto)}` : ''}`);
  }
}

export function registerCartola(program: Command, runtime: Runtime): void {
  withOutputFlags(program.command('cartola'))
    .description(
      'Resumen de tu situación en TGR de los últimos 12 meses: deudas por tipo, estado de ' +
        'cobranza y convenios. SOLO LECTURA.',
    )
    .action(async () => {
      const result = await readCartola(runtime);
      emit(result, () => {
        section('Deudas', result.deudas);
        section('Cobranza', result.cobranza);
        section('Convenios', result.convenios);

        // The single most consequential fact on this page — say it plainly instead of leaving it
        // to be spotted in a list of zeros.
        const enCobranza = result.cobranza.filter((f) => f.cantidad > 0);
        out('');
        if (enCobranza.length > 0) {
          out(
            `⚠️  Tienes ${enCobranza.length} tipo(s) de cuenta en cobranza: ` +
              `${enCobranza.map((f) => `${f.tipo} (${f.cantidad})`).join(', ')}.`,
          );
        } else {
          out('Sin cuentas en cobranza.');
        }
      });
    });
}
