import { describe, expect, it } from 'vitest';
import {
  FakePortalDriver,
  FixedClock,
  InMemoryKeyValueStore,
  RecordingAuditSink,
} from '@dostertags/tgr-core/testing';
import type { Runtime } from '@dostertags/tgr-core';
import { buildProgram } from './program.js';

function runtime(): Runtime {
  return {
    clock: new FixedClock(new Date('2026-08-10T12:00:00.000Z')),
    audit: new RecordingAuditSink(),
    store: new InMemoryKeyValueStore(),
    portal: new FakePortalDriver(),
  };
}

describe('command tree', () => {
  const program = buildProgram(runtime());

  it('is named tgr', () => {
    expect(program.name()).toBe('tgr');
  });

  it('announces that it is read-only', () => {
    expect(program.description()).toContain('SOLO LECTURA');
  });

  it('exposes exactly the v1 auth commands', () => {
    const auth = program.commands.find((c) => c.name() === 'auth');
    expect(auth).toBeDefined();
    expect(auth!.commands.map((c) => c.name()).sort()).toEqual(['login', 'logout', 'status']);
  });

  it('exposes no payment command (ADR-006)', () => {
    const names = program.commands.flatMap((c) => [c.name(), ...c.commands.map((s) => s.name())]);
    for (const name of names) {
      expect(name).not.toMatch(/pag(o|ar)|payment/i);
    }
  });
});
