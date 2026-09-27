import { describe, expect, it } from 'vitest';
import { FixedClock, RecordingAuditSink } from '../adapters/fake/index.js';
import { recordAudit } from './audit.js';

function deps() {
  return {
    clock: new FixedClock(new Date('2026-08-10T12:00:00.000Z')),
    audit: new RecordingAuditSink(),
  };
}

describe('recordAudit', () => {
  it('stamps ts from the injected clock, never wall time', () => {
    const d = deps();
    recordAudit(d, { action: 'auth_login', result: 'ok' });
    expect(d.audit.entries[0]?.['ts']).toBe('2026-08-10T12:00:00.000Z');
  });

  it('lets a RUT through — a RUT is not a secret', () => {
    const d = deps();
    recordAudit(d, { action: 'auth_login', result: 'ok', rut: '77777777-7' });
    expect(d.audit.entries[0]?.['rut']).toBe('77777777-7');
  });

  it('drops secret-named keys at the top level', () => {
    const d = deps();
    recordAudit(d, {
      action: 'auth_login',
      result: 'ok',
      clave: 'no',
      password: 'no',
      cookies: 'no',
      accessToken: 'no',
    });
    const entry = d.audit.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(['action', 'result', 'ts']);
  });

  it('drops an OAuth authorization code — TGR is a code flow, so `code` is a credential', () => {
    const d = deps();
    recordAudit(d, { action: 'auth_login', result: 'ok', code: 'live-authorization-code' });
    expect(JSON.stringify(d.audit.entries[0])).not.toContain('live-authorization-code');
  });

  it('scrubs nested secrets, not just depth 1', () => {
    const d = deps();
    recordAudit(d, {
      action: 'auth_login',
      result: 'ok',
      detail: { nested: { cookie: 'leak', keep: 1 } },
    });
    const json = JSON.stringify(d.audit.entries[0]);
    expect(json).not.toContain('leak');
    expect(json).toContain('keep');
  });

  it('scrubs inside arrays', () => {
    const d = deps();
    recordAudit(d, { action: 'x', result: 'ok', items: [{ token: 'leak', name: 'ok' }] });
    const json = JSON.stringify(d.audit.entries[0]);
    expect(json).not.toContain('leak');
    expect(json).toContain('ok');
  });

  it('survives a cyclic structure without throwing', () => {
    const d = deps();
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    expect(() => recordAudit(d, { action: 'x', result: 'ok', cyclic })).not.toThrow();
  });
});
