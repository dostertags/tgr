import type { LoginDestination } from '../config/index.js';

// Injectable seams (ADR-002): the external / non-deterministic dependencies the core reaches
// through interfaces. Node defaults live in adapters/node; in-memory fakes for tests live in
// adapters/fake. The core never imports Playwright, node:fs, or a keyring directly.
//
// This surface is deliberately MINIMAL — it declares what v1 uses and nothing more. v1 has no
// read surfaces (ADR-008 scope), so there is no requestJson/requestForm/requestText here yet.
// They arrive with the facades that need them, shaped by observation rather than by analogy.

export interface Clock {
  now(): Date;
  /** Pause for `ms` — the pacing primitive (CONVENTIONS: ~1 rps). Fakes resolve instantly. */
  sleep(ms: number): Promise<void>;
}

/** One audit receipt line. The audit module stamps `ts` and drops secret-named keys. */
export interface AuditEntry {
  readonly action: string;
  readonly result: string;
  readonly rut?: string | null;
  readonly durationMs?: number;
  readonly [extra: string]: unknown;
}

export interface AuditSink {
  record(entry: AuditEntry): void;
}

/** Namespaced local JSON store. Modules use DISTINCT keys so they never write the same file. */
export interface KeyValueStore {
  read<T>(key: string): Promise<T | null>;
  write<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/** OS secure storage for the ADR-004 credential path. Declared now, no Node adapter until v1.1. */
export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** The shape of a live session — NAMES ONLY, never values (ADR-009).
 *
 *  This exists to answer the questions ADR-005 and ADR-008 leave open, and it is the reason
 *  `--observe` runs INSIDE the login flow: a post-hoc tool would have to `restore()` first, and
 *  "does restore work?" is exactly what is under test. */
export interface SessionAnatomy {
  /** Landed URL with query and hash ALREADY STRIPPED by the adapter. Non-negotiable: TGR is an
   *  OAuth authorization-code flow, so a raw terminal URL can carry a live `?code=` credential. */
  readonly landedUrl: string;
  /** Cookie domain → cookie NAMES (sorted, de-duplicated). No values, ever. */
  readonly cookieNamesByDomain: Readonly<Record<string, readonly string[]>>;
  /** Origin → storage KEY NAMES. No values, ever. `sessionStorage` is only observable for the
   *  page's current origin, so other origins report an empty list rather than a false absence. */
  readonly storageKeyNamesByOrigin: Readonly<
    Record<
      string,
      { readonly localStorage: readonly string[]; readonly sessionStorage: readonly string[] }
    >
  >;
}

/** A browser context with cookies loaded. All portal access goes through here, so the core never
 *  imports Playwright. */
export interface PortalSession {
  /** Navigate; returns the URL actually landed on (for origin-based auth detection, ADR-003).
   *  Implementations MUST refuse a payment host (ADR-006). */
  goto(url: string): Promise<string>;
  /** Evaluate a JS expression in the page; returns its JSON-serialisable result. */
  evaluate<T>(expression: string): Promise<T>;
  /** Evaluate INSIDE the first frame whose URL contains `frameMatch` (ADR-011).
   *
   *  TGR serves every authenticated trámite as a WordPress shell embedding the real Java app in an
   *  iframe. We read that app by letting the iframe render and reading it here — we never build or
   *  replay the signed `vr` URL that points at it. Rejects if no such frame is present, because a
   *  missing app frame means the page shape changed and must fail loud. */
  evaluateInFrame<T>(frameMatch: string, expression: string): Promise<T>;
  /** Tick a radio/checkbox inside the frame. Purely local — no request leaves the browser, so
   *  there is nothing to wait for. Its single sanctioned use is selecting the non-payment
   *  `tipoPago` option; see `TIPO_PAGO_COMPROBANTE` (ADR-011). */
  checkInFrame(frameMatch: string, selector: string): Promise<void>;
  /** Click a control that SUBMITS, and wait for the resulting round-trip to land (ADR-011).
   *
   *  Kept separate from `checkInFrame` deliberately: TGR's embedded apps are classic
   *  server-rendered forms, so a submit replaces the frame's document. Conflating the two meant
   *  scraping the pre-submit page and finding nothing. */
  clickInFrame(frameMatch: string, selector: string): Promise<void>;
  /** Capture the session's shape for the wire contract — names only (ADR-009). */
  anatomy(): Promise<SessionAnatomy>;
  /** The storage state to persist. Cookies-only for now (ADR-005). */
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}

export interface InteractiveLoginOptions {
  /** Post-login destination. A CLOSED union, not `string`, so no caller input reaches a login
   *  URL (ADR-003). Type-only import — no runtime coupling between seam and config. */
  readonly destination: LoginDestination;
  /** Give up if we have not landed on an APP host within this budget (ms). */
  readonly timeoutMs: number;
}

export interface PortalDriver {
  /** Open a HEADED browser at TGR's login entry; resolve with a session once the browser lands on
   *  a terminal APP host (ADR-003). The user picks the IdP and types the credential into the real
   *  page — it never crosses this boundary. Rejects (LoginFailedError) on timeout / window close. */
  interactiveLogin(options: InteractiveLoginOptions): Promise<PortalSession>;
  /** Restore a (headless) session from persisted state, for liveness checks and future reads.
   *  Whether cookies alone suffice is the open question of ADR-005. */
  restore(storageState: unknown): Promise<PortalSession>;
}

/** The set of seams a task needs. The composition root (node.ts) builds it. */
export interface Runtime {
  readonly clock: Clock;
  readonly audit: AuditSink;
  readonly store: KeyValueStore;
  readonly portal: PortalDriver;
  readonly secrets?: SecretStore;
}
