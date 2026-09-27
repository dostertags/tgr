// Use-case orchestration for the deudas read. Surfaces call THIS, never the facade (ADR-002).
import { withSession } from '../auth/session.js';
import { recordAudit } from '../audit/index.js';
import { fetchDeudasFiscales } from '../portal/deudas.js';
import type { DeudasFiscales } from '../portal/deudas.js';
import type { Runtime } from '../seams/index.js';

/** List the empresa's fiscal + aduanero debts (the read half of the DIN surface, ADR-011).
 *
 *  The audit receipt records the COUNT and the total, never the individual folios — a folio plus
 *  an amount is the substance of the debt, and a receipt exists to prove an action happened, not
 *  to duplicate the data. Errors propagate verbatim; nothing is retried (CONVENTIONS). */
export async function listDeudasFiscales(runtime: Runtime): Promise<DeudasFiscales> {
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, (session) =>
      fetchDeudasFiscales(session, runtime.clock),
    );
    recordAudit(runtime, {
      action: 'deudas_fiscales_list',
      result: 'ok',
      count: result.deudas.length,
      totalCLP: result.totalCLP,
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (err) {
    recordAudit(runtime, { action: 'deudas_fiscales_list', result: 'failed' });
    throw err;
  }
}
