import { describe, expect, it } from 'vitest';
import {
  LoginFailedError,
  NotAuthenticatedError,
  PaymentSurfaceBlockedError,
  PortalTimeoutError,
  RateLimitError,
} from '@dostertags/tgr-core';
import { exitCodeFor } from './io.js';

describe('exitCodeFor', () => {
  it('keeps the documented codes', () => {
    expect(exitCodeFor(new NotAuthenticatedError('x'))).toBe(2);
    expect(exitCodeFor(new LoginFailedError('x'))).toBe(3);
    expect(exitCodeFor(new RateLimitError('x'))).toBe(4);
    expect(exitCodeFor(new PaymentSurfaceBlockedError('x'))).toBe(5);
    expect(exitCodeFor(new Error('x'))).toBe(1);
  });

  it('gives a slow portal its own code, so a script can tell "try later" from "broken"', () => {
    expect(exitCodeFor(new PortalTimeoutError('x'))).toBe(6);
  });
});
