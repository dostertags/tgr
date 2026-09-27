import type { AuditEntry, AuditSink, Clock } from '../seams/index.js';

/** Keys whose presence (substring, case-insensitive) means "secret" — dropped before the line
 *  hits the sink. RUTs are NOT secrets and pass through. */
const SECRET_KEY = /password|clave|cookie|secret|token|code/i;

/** Recursion cap. Audit entries are shallow by construction; this only stops a pathological or
 *  cyclic structure from blowing the stack (the sink is best-effort and must never throw). */
const MAX_DEPTH = 8;

/** Strip secret-named keys at ANY depth. Non-objects pass through untouched; arrays are scrubbed
 *  element-wise. Note `code` in the pattern above: TGR's flow is OAuth authorization-code, so a
 *  stray `{ code }` in an entry would be a live credential, not a status code. */
function scrub(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  // `typeof null === 'object'`, so null must be excluded before treating this as a record.
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** Compose the final receipt: stamp `ts` from the clock, drop secret-substring keys AT EVERY
 *  DEPTH, hand it to the sink. Never throws (the sink is best-effort). */
export function recordAudit(deps: { clock: Clock; audit: AuditSink }, entry: AuditEntry): void {
  const safe: Record<string, unknown> = { ts: deps.clock.now().toISOString() };
  for (const [k, v] of Object.entries(entry)) {
    if (SECRET_KEY.test(k)) continue;
    safe[k] = scrub(v, 1);
  }
  deps.audit.record(safe as AuditEntry);
}
