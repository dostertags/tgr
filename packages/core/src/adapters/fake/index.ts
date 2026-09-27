// In-memory fakes for tests — never touch real TGR / fs / clock.
import { isPaymentHost } from '../../config/index.js';
import { PaymentSurfaceBlockedError } from '../../errors/index.js';
import type {
  AuditEntry,
  AuditSink,
  Clock,
  InteractiveLoginOptions,
  KeyValueStore,
  PortalDriver,
  PortalSession,
  SessionAnatomy,
} from '../../seams/index.js';

export class FixedClock implements Clock {
  /** Each `sleep(ms)` is recorded (not awaited) so a test can assert pacing without waiting. */
  readonly slept: number[] = [];
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
  sleep(ms: number): Promise<void> {
    this.slept.push(ms);
    return Promise.resolve();
  }
}

export class RecordingAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  async read<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async write<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/** A context in which nothing happened — no cookies at all. Use it to exercise the
 *  "the OAuth exchange never ran" path. */
export const EMPTY_ANATOMY: SessionAnatomy = {
  landedUrl: 'https://www.tesoreria.cl/',
  cookieNamesByDomain: {},
  storageKeyNamesByOrigin: {},
};

/** The DEFAULT for a fake session: a normal post-exchange context, carrying the portal cookie
 *  that `hasCompletedExchange` looks for. Shapes and names mirror what was observed live on
 *  2026-08-10. A test that wants the negative case passes an explicit `anatomy`. */
export const EXCHANGED_ANATOMY: SessionAnatomy = {
  landedUrl: 'https://www.tesoreria.cl/LoginPortalCognito/null',
  cookieNamesByDomain: { 'www.tesoreria.cl': ['JSESSIONID', 'userCognito'] },
  storageKeyNamesByOrigin: {},
};

export interface FakeSessionScript {
  /** URL the session "lands on" after goto (defaults to the requested URL). */
  landingUrl?: string;
  evaluate?: (expression: string) => unknown;
  /** Result for `evaluateInFrame`. Called with the frame match and the expression, so a script can
   *  return different payloads before and after the gate is passed. */
  evaluateInFrame?: (frameMatch: string, expression: string) => unknown;
  /** Side-effect hook for `clickInFrame` — lets a script advance its own state machine. */
  onClickInFrame?: (frameMatch: string, selector: string) => void;
  anatomy?: SessionAnatomy;
  storageState?: unknown;
  /** When it returns an Error for a URL, `goto` rejects with it (simulate a navigation timeout on
   *  a slow TGR page). The URL is still recorded in `gotos` — the attempt was made. */
  failGoto?: (url: string) => Error | undefined;
}

export class FakePortalSession implements PortalSession {
  closed = false;
  /** Every URL passed to goto, in order. */
  readonly gotos: string[] = [];
  /** Every expression passed to evaluate, in order. */
  readonly evaluatedExpressions: string[] = [];
  anatomyCalls = 0;
  constructor(private readonly script: FakeSessionScript = {}) {}

  async goto(url: string): Promise<string> {
    // The fake enforces the ADR-006 tripwire too, so a task that ever aims at a payment surface
    // fails in unit tests rather than only in front of a real browser.
    if (isPaymentHost(url)) {
      throw new PaymentSurfaceBlockedError(
        `Navegación bloqueada (fake): ${url} es superficie de pago.`,
      );
    }
    this.gotos.push(url);
    const failure = this.script.failGoto?.(url);
    if (failure) throw failure;
    return this.script.landingUrl ?? url;
  }

  async evaluate<T>(expression: string): Promise<T> {
    this.evaluatedExpressions.push(expression);
    return (this.script.evaluate?.(expression) ?? null) as T;
  }

  /** Every (frameMatch, expression) pair evaluated in a frame, in order. */
  readonly frameEvaluations: { frameMatch: string; expression: string }[] = [];
  async evaluateInFrame<T>(frameMatch: string, expression: string): Promise<T> {
    this.frameEvaluations.push({ frameMatch, expression });
    return (this.script.evaluateInFrame?.(frameMatch, expression) ?? null) as T;
  }

  /** Every (frameMatch, selector) interacted with, in order — checks and clicks alike. Lets a
   *  test assert EXACTLY what this tool touched, which is how ADR-011's "one POST only" rule is
   *  kept honest. */
  readonly frameClicks: { frameMatch: string; selector: string; kind: 'check' | 'click' }[] = [];
  async checkInFrame(frameMatch: string, selector: string): Promise<void> {
    this.frameClicks.push({ frameMatch, selector, kind: 'check' });
    this.script.onClickInFrame?.(frameMatch, selector);
  }
  async clickInFrame(frameMatch: string, selector: string): Promise<void> {
    this.frameClicks.push({ frameMatch, selector, kind: 'click' });
    this.script.onClickInFrame?.(frameMatch, selector);
  }

  async anatomy(): Promise<SessionAnatomy> {
    this.anatomyCalls++;
    return (
      this.script.anatomy ?? {
        ...EXCHANGED_ANATOMY,
        landedUrl: this.script.landingUrl ?? EXCHANGED_ANATOMY.landedUrl,
      }
    );
  }

  async storageState(): Promise<unknown> {
    return this.script.storageState ?? { cookies: [] };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

export interface FakeDriverScript {
  loginSession?: FakeSessionScript | (() => FakeSessionScript);
  restoreSession?: FakeSessionScript | (() => FakeSessionScript);
  /** When set, interactiveLogin rejects with this (simulate timeout / window close). */
  failLogin?: Error;
  /** When set, restore rejects with this (simulate an unusable cookie jar). */
  failRestore?: Error;
}

export class FakePortalDriver implements PortalDriver {
  interactiveLoginCalls = 0;
  restoreCalls = 0;
  /** Sessions handed out, so a test can assert every one of them was closed. */
  readonly sessions: FakePortalSession[] = [];
  constructor(private readonly script: FakeDriverScript = {}) {}

  async interactiveLogin(_options: InteractiveLoginOptions): Promise<PortalSession> {
    this.interactiveLoginCalls++;
    if (this.script.failLogin) throw this.script.failLogin;
    const s =
      typeof this.script.loginSession === 'function'
        ? this.script.loginSession()
        : this.script.loginSession;
    const session = new FakePortalSession(s ?? {});
    this.sessions.push(session);
    return session;
  }

  async restore(_storageState: unknown): Promise<PortalSession> {
    this.restoreCalls++;
    if (this.script.failRestore) throw this.script.failRestore;
    const s =
      typeof this.script.restoreSession === 'function'
        ? this.script.restoreSession()
        : this.script.restoreSession;
    const session = new FakePortalSession(s ?? {});
    this.sessions.push(session);
    return session;
  }
}
