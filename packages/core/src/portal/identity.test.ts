import { describe, expect, it } from 'vitest';
import { parseIdentityFromHandoffLink } from './identity.js';

// SYNTHETIC values only — the shape is real (observed 2026-08-10), the data is not.
// 77777777-7 is a valid Mod-11 RUT; the tokens are filler of the observed length.
function handoff(
  overrides: {
    body?: string;
    dv?: string;
    targetBody?: string;
    idp?: string;
    razonSocial?: string | null;
    fields?: string[];
  } = {},
): string {
  const body = overrides.body ?? '77777777';
  const dv = overrides.dv ?? '7';
  const targetBody = overrides.targetBody ?? body;
  const fields = overrides.fields ?? [
    'a'.repeat(32),
    '2026-08-10T19:55:23Z',
    body,
    'b'.repeat(32),
    `/CartolaFiscalInterWeb/cartolaFiscal/begin?RUT=${targetBody}&DV=${dv}`,
    overrides.idp ?? 'ClaveTributaria',
  ];
  const vr = Buffer.from(fields.join(','), 'utf8').toString('base64');
  const no =
    overrides.razonSocial === null
      ? ''
      : `&no=${encodeURIComponent(overrides.razonSocial ?? 'Empresa Ficticia SpA')}`;
  return (
    'https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/' +
    `?go=https://www.tesoreria.cl/LoginPortalPagosTGR12Web/redirect?vr=${vr}${no}&ap=`
  );
}

describe('parseIdentityFromHandoffLink', () => {
  it('extracts the canonical RUT, razón social and IdP', () => {
    expect(parseIdentityFromHandoffLink(handoff())).toEqual({
      rut: '77777777-7',
      razonSocial: 'Empresa Ficticia SpA',
      idp: 'ClaveTributaria',
    });
  });

  it('handles a K check digit', () => {
    expect(parseIdentityFromHandoffLink(handoff({ body: '13000007', dv: 'K' }))?.rut).toBe(
      '13000007-K',
    );
  });

  it('reports which IdP authenticated the session', () => {
    expect(parseIdentityFromHandoffLink(handoff({ idp: 'ClaveUnica' }))?.idp).toBe('ClaveUnica');
  });

  it('returns null razón social when the link omits it, rather than inventing one', () => {
    expect(parseIdentityFromHandoffLink(handoff({ razonSocial: null }))?.razonSocial).toBeNull();
  });

  it('FAILS CLOSED when the RUT body disagrees with the target path', () => {
    // A layout change that shifted the fields must not yield a confidently wrong RUT.
    expect(
      parseIdentityFromHandoffLink(handoff({ body: '77777777', targetBody: '12345678' })),
    ).toBeNull();
  });

  it('FAILS CLOSED on an invalid check digit', () => {
    expect(parseIdentityFromHandoffLink(handoff({ body: '77777777', dv: '8' }))).toBeNull();
  });

  it('ignores links that are not the hand-off', () => {
    for (const href of [
      'https://web.tesoreria.cl/convenios-de-pago/',
      'https://tgr.gob.cl/',
      'https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/?go=https://example.com/x?vr=abc',
    ]) {
      expect(parseIdentityFromHandoffLink(href), href).toBeNull();
    }
  });

  it('never throws on malformed input', () => {
    for (const href of [
      '',
      'not a url',
      'https://web.tesoreria.cl/?go=LoginPortalPagosTGR12Web/redirect?vr=%%%',
    ]) {
      expect(() => parseIdentityFromHandoffLink(href)).not.toThrow();
      expect(parseIdentityFromHandoffLink(href)).toBeNull();
    }
  });

  it('returns null when the payload has too few fields', () => {
    expect(
      parseIdentityFromHandoffLink(handoff({ fields: ['tok', '2026-08-10T00:00:00Z'] })),
    ).toBeNull();
  });
});
