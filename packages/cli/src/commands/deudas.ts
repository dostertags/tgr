import type { Command } from 'commander';
import { listDeudasFiscales, type Runtime } from '@dostertags/tgr-core';
import { emit, out, withOutputFlags } from '../io.js';

/** CLP with Chilean thousands separators, for `--human` output only. */
function clp(n: number | null): string {
  return n === null ? '(no interpretado)' : `$${n.toLocaleString('es-CL')}`;
}

export function registerDeudas(program: Command, runtime: Runtime): void {
  const deudas = program
    .command('deudas')
    .description('Deudas de impuestos fiscales y aduaneros (incluye cargos de importación).');

  withOutputFlags(deudas.command('list'))
    .description(
      'Lista tus deudas de impuestos fiscales y aduaneros. SOLO LECTURA: no genera cupón ' +
        'ni inicia ningún pago (ADR-011).',
    )
    .action(async () => {
      const result = await listDeudasFiscales(runtime);
      emit(result, () => {
        if (result.deudas.length === 0) {
          out('No tienes deudas de impuestos fiscales ni aduaneros.');
          return;
        }
        out(`${result.deudas.length} deuda(s). Total: ${clp(result.totalCLP)}`);
        out('');
        for (const d of result.deudas) {
          out(
            `  Formulario ${d.formulario} · folio ${d.folio} · vence ${d.vencimientoRaw} · ` +
              clp(d.totalAPagar),
          );
        }
      });
    });
}
