// Use-case orchestration for the cartola read. Surfaces call THIS, never the facade (ADR-002).
import { withSession } from '../auth/session.js';
import { recordAudit } from '../audit/index.js';
import { fetchCartola } from '../portal/cartola.js';
import type { CartolaResumen } from '../portal/cartola.js';
import type { Runtime } from '../seams/index.js';

/** The 12-month summary of the principal's situation at TGR.
 *
 *  The audit receipt records only SHAPE — how many rows per section, and whether anything is in
 *  collection. Amounts and per-type detail stay off the receipt: a receipt exists to prove the
 *  read happened, not to duplicate the taxpayer's financial position. */
export async function readCartola(runtime: Runtime): Promise<CartolaResumen> {
  const start = runtime.clock.now().getTime();
  try {
    const result = await withSession(runtime, (session) => fetchCartola(session, runtime.clock));
    recordAudit(runtime, {
      action: 'cartola_read',
      result: 'ok',
      deudaTipos: result.deudas.length,
      enCobranza: result.cobranza.some((f) => f.cantidad > 0),
      durationMs: runtime.clock.now().getTime() - start,
    });
    return result;
  } catch (err) {
    recordAudit(runtime, { action: 'cartola_read', result: 'failed' });
    throw err;
  }
}
