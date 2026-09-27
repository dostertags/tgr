// The `tgr` command tree (commander). Every action is a thin call into a @dostertags/tgr-core
// task — the CLI never reaches past the task layer (ADR-002). The Runtime is injected so tests
// drive the whole tree against fakes (no TGR touched).
import { createRequire } from 'node:module';
import { Command } from 'commander';
import type { Runtime } from '@dostertags/tgr-core';
import { setOutputMode, withOutputFlags } from './io.js';
import { registerAuth } from './commands/auth.js';
import { registerDeudas } from './commands/deudas.js';
import { registerCartola } from './commands/cartola.js';

// The version, read from this package's own package.json at runtime (one level up from dist/).
const pkgVersion = (createRequire(import.meta.url)('../package.json') as { version: string })
  .version;

export function buildProgram(runtime: Runtime): Command {
  const program = new Command();
  program
    .name('tgr')
    .description(
      'CLI para consultar la Tesorería General de la República (Chile). ' +
        'SOLO LECTURA: esta herramienta no paga nada (ADR-006).',
    )
    .version(pkgVersion);

  withOutputFlags(program);

  program.hook('preAction', (_thisCommand, actionCommand) => {
    setOutputMode(actionCommand.optsWithGlobals().human ? 'human' : 'json');
  });

  registerAuth(program, runtime);
  registerDeudas(program, runtime);
  registerCartola(program, runtime);

  return program;
}
