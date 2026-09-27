// Main barrel — the PURE library surface. Importing this never evaluates `node:*` or Playwright:
// the Node adapters and the composition root live on the `/node` subpath (ADR-002).

export * from './config/index.js';
export * from './errors/index.js';
export * from './rut/index.js';
export * from './format/index.js';
export * from './audit/index.js';
export * from './observe/index.js';
export * from './seams/index.js';

// Portal facades expose their TYPES and pure parsers on the barrel; surfaces must call tasks, not
// the fetch functions (ADR-002).
export type { DeudaFiscal, DeudasFiscales, RawTable } from './portal/deudas.js';
export {
  EXPECTED_HEADERS,
  parseDeudasTable,
  parseMontoCLP,
  parseFechaDdMmYyyy,
} from './portal/deudas.js';
export type { CartolaFila, CartolaResumen, CartolaTable } from './portal/cartola.js';
export { parseCartola, parseTipoCell } from './portal/cartola.js';
export type { TgrIdentity } from './portal/identity.js';
export { parseIdentityFromHandoffLink } from './portal/identity.js';

// Tasks — the only domain surface the CLI is allowed to call.
export * from './tasks/index.js';

// Auth TASKS — the only surface the CLI is allowed to call (ADR-002).
export { localStatus, login, logout } from './auth/auth.js';
export type {
  AuthLoginResult,
  AuthLogoutResult,
  AuthStatusLocal,
  LoginOptions,
} from './auth/auth.js';

// The session PRIMITIVES (`readSession`/`writeSession`/`deleteSession`) are deliberately NOT
// exported here: surfaces call tasks, never the raw session store (ADR-002). They are available
// on the `/node` subpath for internal tooling that is explicitly not a CLI/MCP surface.
export type { StoredSession } from './auth/session.js';
