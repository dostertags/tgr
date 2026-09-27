// Output + error→exit-code mapping. TGR's Spanish messages pass through unchanged (CONVENTIONS).
import type { Command } from 'commander';
import {
  LoginFailedError,
  NotAuthenticatedError,
  PaymentSurfaceBlockedError,
  PortalTimeoutError,
  RateLimitError,
} from '@dostertags/tgr-core';

// JSON is the DEFAULT output: the CLI is a faithful façade over the core library contract (tasks
// return plain, JSON-serialisable objects), so driving it from a script yields structured data.
// `--human` switches to the readable rendering.
type OutputMode = 'json' | 'human';
let outputMode: OutputMode = 'json';

export function setOutputMode(mode: OutputMode): void {
  outputMode = mode;
}
export function isHumanMode(): boolean {
  return outputMode === 'human';
}

/** STDOUT line. */
export function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** Diagnostics go to STDERR so STDOUT stays pipeable. */
export function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Emit a command result: the task's object as pretty JSON by default, the human renderer under
 *  `--human`. */
export function emit(data: unknown, human: () => void): void {
  if (outputMode === 'human') human();
  else out(JSON.stringify(data, null, 2));
}

/** The two global output flags. Added to the root AND every leaf so they parse in any position. */
export function withOutputFlags(cmd: Command): Command {
  return cmd
    .option('--json', 'Salida en JSON (por defecto).')
    .option('--human', 'Salida legible para humanos en vez de JSON.');
}

/** Exit-code contract: NotAuthenticated → 2 (incl. SessionExpired), LoginFailed → 3,
 *  RateLimit → 4, PaymentSurfaceBlocked → 5, PortalTimeout → 6, anything else → 1.
 *
 *  5 gets its own code deliberately: if that error ever fires, something aimed this tool at a
 *  payment page (ADR-006) and it must be distinguishable from ordinary failure in a script. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof NotAuthenticatedError) return 2;
  if (error instanceof LoginFailedError) return 3;
  if (error instanceof RateLimitError) return 4;
  if (error instanceof PaymentSurfaceBlockedError) return 5;
  // 6: TGR was too slow. Transient, unlike 1 — a script may reasonably try again later.
  if (error instanceof PortalTimeoutError) return 6;
  return 1;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
