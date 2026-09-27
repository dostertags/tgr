import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { Rut } from './rut.js';

describe('Rut', () => {
  it('parses dotted, hyphenated and bare forms to one canonical value', () => {
    for (const input of ['77.777.777-7', '77777777-7', '777777777']) {
      expect(Rut.parse(input).canonical).toBe('77777777-7');
    }
  });

  it('accepts a K check digit, case-insensitively', () => {
    expect(Rut.parse('13000007-k').canonical).toBe('13000007-K');
  });

  it('renders the human form with thousands separators', () => {
    expect(Rut.parse('77777777-7').formatted).toBe('77.777.777-7');
  });

  it('rejects a wrong check digit and names the expected one', () => {
    expect(() => Rut.parse('77777777-8')).toThrow(ValidationError);
    expect(() => Rut.parse('77777777-8')).toThrow(/esperado -7/);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '7', 'abc-1', '7777777X-1']) {
      expect(() => Rut.parse(bad), bad).toThrow(ValidationError);
    }
  });

  it('tryParse returns null instead of throwing', () => {
    expect(Rut.tryParse('77777777-8')).toBeNull();
    expect(Rut.tryParse('77777777-7')?.canonical).toBe('77777777-7');
  });

  it('compares by value', () => {
    expect(Rut.parse('77.777.777-7').equals(Rut.parse('777777777'))).toBe(true);
  });
});
