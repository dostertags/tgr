import { describe, expect, it } from 'vitest';
import { FakePortalSession, FixedClock } from '../adapters/fake/index.js';
import { NotAuthenticatedError, PortalReadError } from '../errors/index.js';
import { openTramite } from './tramite.js';

const SHELL = 'https://web.tesoreria.cl/tramites-tgr/mi-cartola-fiscal/';
const APP = 'CartolaFiscalInterWeb';

/** A fake app that denies the first `deniedTimes` loads, mirroring what TGR actually does. */
function app(deniedTimes: number) {
  let loads = 0;
  return new FakePortalSession({
    landingUrl: SHELL,
    evaluateInFrame: () => {
      loads += 1;
      return loads <= deniedTimes;
    },
  });
}

describe('openTramite', () => {
  it('navigates once when the app is immediately usable', async () => {
    const session = app(0);
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    await openTramite(session, clock, SHELL, APP);

    expect(session.gotos).toEqual([SHELL]);
    expect(clock.slept).toEqual([]);
  });

  it('bootstraps exactly once when the first hand-off is refused', async () => {
    // The observed TGR behaviour: first load says "Usuario No Autorizado", the next one renders.
    const session = app(1);
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    await openTramite(session, clock, SHELL, APP);

    expect(session.gotos).toEqual([SHELL, SHELL]);
  });

  it('paces before the bootstrap rather than hammering', async () => {
    const session = app(1);
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    await openTramite(session, clock, SHELL, APP);

    expect(clock.slept).toEqual([1000]);
  });

  it('gives up after ONE bootstrap — never loops', async () => {
    const session = app(99);
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    await expect(openTramite(session, clock, SHELL, APP)).rejects.toThrow(PortalReadError);
    // Two navigations total: the original and the single bootstrap. Not three, not N.
    expect(session.gotos).toEqual([SHELL, SHELL]);
  });

  it('returns the landed URL so the caller can apply its own auth check', async () => {
    const session = app(0);
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    expect(await openTramite(session, clock, SHELL, APP)).toBe(SHELL);
  });

  it('reports an EXPIRED SESSION rather than a phantom scraper failure', async () => {
    // Sessions last about an hour, so this is the routine failure. Before the landing check moved
    // ahead of the frame lookup, an expired jar reported "the trámite changed structure" — which
    // sends the user hunting for a bug instead of logging in (observed 2026-08-12).
    const session = new FakePortalSession({
      landingUrl: 'https://autentica.tgr.cl/oauth2/authorize-front',
    });
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    await expect(openTramite(session, clock, SHELL, APP)).rejects.toThrow(NotAuthenticatedError);
    // And it must not have gone poking at frames first.
    expect(session.frameEvaluations).toHaveLength(0);
  });

  it('STRIPS the query — the shell URL carries a signed vr hand-off once its script runs', async () => {
    const withToken = `${SHELL}?go=https://www.tesoreria.cl/x?vr=SECRETTOKEN&no=Empresa`;
    const session = new FakePortalSession({ landingUrl: withToken, evaluateInFrame: () => false });
    const clock = new FixedClock(new Date('2026-08-12T12:00:00.000Z'));

    const landed = await openTramite(session, clock, SHELL, APP);

    expect(landed).toBe(SHELL);
    expect(landed).not.toContain('SECRETTOKEN');
  });
});
