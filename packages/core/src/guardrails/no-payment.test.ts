// ADR-006 ENFORCEMENT. This is not a style check — it is the control that makes "read-only by
// construction" true rather than aspirational.
//
// It walks every .ts file under packages/*/src and fails if any of them names a TGR payment host.
// Exactly two files are exempt: the denylist module that declares the hosts, and this test.
//
// If this test fails, do NOT add your file to the exemption list. Point your facade at an APP
// host instead (config.ts APP_HOSTS). There is no legitimate reason for another module to
// reference a payment surface, because this tool does not pay.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_FORM_VALUES, PAYMENT_HOSTS, isPaymentHost } from '../config/payment-denylist.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const packagesDir = path.join(repoRoot, 'packages');

const EXEMPT = new Set(
  [
    path.join(packagesDir, 'core', 'src', 'config', 'payment-denylist.ts'),
    path.join(here, 'no-payment.test.ts'),
  ].map((p) => path.normalize(p)),
);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collectSourceFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(path.normalize(full));
  }
  return out;
}

describe('ADR-006 — no payment surface exists in this repository', () => {
  const files = collectSourceFiles(packagesDir).filter((f) => !EXEMPT.has(f));

  it('the denylist is populated (this test must not pass vacuously)', () => {
    expect(PAYMENT_HOSTS.length).toBeGreaterThan(0);
    expect(FORBIDDEN_FORM_VALUES.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
  });

  it('no module outside the denylist references a TGR payment host', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const host of PAYMENT_HOSTS) {
        if (source.includes(host)) {
          offenders.push(`${path.relative(repoRoot, file)} → ${host}`);
        }
      }
    }
    expect(
      offenders,
      'Un módulo referencia una superficie de PAGO de la TGR. Esta herramienta es de solo ' +
        'lectura por construcción (ADR-006): apunta a un host de aplicación, no a uno de pago.',
    ).toEqual([]);
  });

  it('no module references a form value that selects a PAYMENT branch (ADR-011)', () => {
    // ADR-011 permits exactly one submitted value, the non-payment one. Its counterpart must not
    // exist anywhere in the tree — not in a constant, not in a comment, not in a test fixture.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const value of FORBIDDEN_FORM_VALUES) {
        if (source.includes(value)) {
          offenders.push(`${path.relative(repoRoot, file)} → ${value}`);
        }
      }
    }
    expect(
      offenders,
      'Un módulo referencia el valor de formulario que elige PAGAR EN LÍNEA. Esta herramienta ' +
        'solo envía la opción de comprobante (ADR-011). Ese valor no debe existir en el árbol.',
    ).toEqual([]);
  });
});

describe('isPaymentHost', () => {
  it('recognises every denylisted host', () => {
    for (const host of PAYMENT_HOSTS) {
      expect(isPaymentHost(`https://${host}/algo?x=1`)).toBe(true);
    }
  });

  it('does not flag app or auth hosts', () => {
    expect(isPaymentHost('https://www.tesoreria.cl/LoginPortalCognito/')).toBe(false);
    expect(isPaymentHost('https://tgr.gob.cl/')).toBe(false);
    expect(isPaymentHost('https://autentica.tgr.cl/oauth2/authorize-front')).toBe(false);
  });

  it('does not flag a look-alike host that merely CONTAINS a denylisted name', () => {
    // Hostname equality, not substring matching — `evil-centro-pagos.tgr.cl.example.com` is not
    // the payment host, and treating it as one would be a false positive that teaches people to
    // work around the guard.
    expect(isPaymentHost('https://centro-pagos.tgr.cl.example.com/')).toBe(false);
  });

  it('treats an unparseable URL as not-payment (the caller built it; that is their error)', () => {
    expect(isPaymentHost('not a url')).toBe(false);
  });
});
