// Composition subpath `@dostertags/tgr-core/node` (ADR-002): the Node default adapters plus
// the composition root. Kept OFF the main barrel so importing the library's tasks never evaluates
// `node:*` or Playwright — a consumer that injects its own seams stays free of them entirely.
import { FileAuditSink, FileKeyValueStore, SystemClock } from './adapters/node/index.js';
import { PlaywrightPortalDriver } from './adapters/node/portal.js';
import type { Runtime } from './seams/index.js';

export { FileAuditSink, FileKeyValueStore, SystemClock, TGR_DIR } from './adapters/node/index.js';
export { PlaywrightPortalDriver } from './adapters/node/portal.js';
export { hardenDir, hardenDirCommand } from './adapters/node/acl.js';

// The raw session primitives live HERE, not on the main barrel (ADR-002: surfaces call tasks
// only). Internal tooling that is explicitly not a CLI/MCP surface may use them; the CLI may not.
export { readSession, writeSession, deleteSession } from './auth/session.js';
export type { StoredSession } from './auth/session.js';

/** Composition root: the Node default adapters, any seam replaceable.
 *  e.g. `createNodeRuntime({ audit: myAuditSink })` keeps the other defaults. The default portal
 *  is the Playwright driver — its OPTIONAL `playwright` peer is loaded lazily on first use, so
 *  composing (or overriding `portal`) never needs it installed. */
export function createNodeRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    clock: new SystemClock(),
    audit: new FileAuditSink(),
    store: new FileKeyValueStore(),
    portal: new PlaywrightPortalDriver(),
    ...overrides,
  };
}
