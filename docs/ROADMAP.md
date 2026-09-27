# Roadmap

## v1 — Foundation + login + session anatomy (CLI only) ← current

- [x] Repo skeleton, toolchain, `.gitignore`, context layer
- [x] ADRs 001–009
- [x] `core`: seams, config (hosts + destinations + payment denylist), `Rut`,
      errors, audit, node/fake adapters
- [x] Playwright driver: `interactiveLogin`, `restore`, `anatomy`
- [x] `auth` tasks: `login`, `localStatus`, `logout`; session store
- [x] `tgr auth login [--observe] | status | logout`
- [x] Tests incl. the payment-denylist guardrail
- [x] **First real login** → `docs/tgr-contract/auth-login.md` filled from live observation
- [x] ADR-005 resolved: cookies-only IS sufficient (server-side exchange, no tokens in storage)
- [x] ADR-003 amended: origin-only detection failed OPEN; replaced by origin + path +
      `userCognito` post-condition, and `web.tesoreria.cl` added to `APP_HOSTS`
- [x] `restore()` sets a realistic UA — the CDN refuses headless Chromium with S3 `AccessDenied`
- [x] ADR-008 closed: the principal's RUT, razón social and IdP are read from the cartola
      hand-off link (ADR-010); `auth status` now answers "who am I"
- [x] `goto` waits for client-side redirects — without it the warm check returned true always
- [x] Session TTL measured (see v2) — no constant set, deliberately

**Definition of done:** `tgr auth login` mints a session that `tgr auth status`
reports, and `docs/tgr-contract/auth-login.md` records the observed anatomy.

## v1.1 — Headless credential path

- [ ] Create a Clave TGR **under the empresa's RUT**; confirm empresa RUTs are
      supported. If they are not, ADR-004 must be reopened.
- [ ] `SecretStore` Node adapter (OS keyring)
- [ ] `credentialLogin` against `autentica.tgr.cl/idp/oauth2/authorize`
      (`#rut` / `#password` / `#iniciarSesion`) — one attempt, never retried
- [ ] `tgr auth login --console`

## v2 — First read surfaces ← current

- [x] ADR-011: embedded apps are read by rendering the iframe, never by replaying a `vr` token;
      one enumerated non-payment POST is permitted
- [x] **Deudas fiscales y aduaneras** — the **read** half of the DIN surface (`tgr deudas list`)
- [x] The parked cupón question, settled: generating a cupón stays out of scope (ADR-011)
- [ ] Per-folio detail (blocked — coupled to "imprimir", see ADR-011)
- [x] **Cartola Fiscal** (`tgr cartola`) — deudas by tipo, cobranza state, convenios
- [x] Session TTL measured: ~1 hour (live 58 min, dead 68 min). No local gate, by design
- [ ] Convenios de pago (read) — shell + `CognitoController.jpf` app identified
- [ ] Certificados y comprobantes (read)

## v3 — MCP surface

- [ ] `@dostertags/tgr-mcp` (stdio), read tools only
- [ ] Per-tool permissions; no write tools exist to gate

## Out of scope (see ADRs)

- **Any payment.** Permanently, by construction. (ADR-006)
- **Aduanas (`aduana.cl`).** DIN declaration detail lives there; TGR holds only
  the derived charge. A second portal is a separate project. (ADR-007)
- **`operate` / representación.** No evidence TGR exposes an operable set. (ADR-008)
- **ClaveÚnica credential automation.** reCAPTCHA-gated. (ADR-004)
