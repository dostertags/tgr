# tgr — Tesorería General de la República, en tu terminal

[![CI](https://github.com/dostertags/tgr/actions/workflows/ci.yml/badge.svg)](https://github.com/dostertags/tgr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Núcleo TypeScript + CLI para automatizar consultas rutinarias a la **Tesorería
General de la República** de Chile (TGR), para una empresa que opera sobre su
propio RUT. Compañero del proyecto `sii`: misma arquitectura, portal distinto.

> ⚠️ **Herramienta no oficial.** Este proyecto **no está afiliado a la TGR ni
> respaldado por ella**. Se entrega "tal cual", sin garantía de ningún tipo. Cada
> usuaria/o es responsable de cumplir los términos de servicio de la TGR y la
> legislación chilena. Automatiza el portal de un ente público: úsalo con criterio
> (la cuenta se bloquea tras intentos fallidos; nunca reintentar tras un bloqueo).

> 🔒 **Esta herramienta NO paga.** Con precisión: nunca mueve dinero, nunca genera un
> instrumento de pago, y no envía nada a la TGR salvo **un único selector de modo, no
> transaccional**, que la app de Impuestos Fiscales exige para mostrar la consulta. Los
> hosts de pago y el valor de formulario prohibido viven en un solo módulo, y un test
> rompe el build si aparecen en cualquier otro. Ver
> [ADR-006](docs/decisions/006-read-only-by-construction.md) y
> [ADR-011](docs/decisions/011-embedded-app-reads-and-the-tipopago-gate.md).

## Estado

**v2 en curso.** Login interactivo validado en vivo, identidad del principal
resuelta, y dos superficies de lectura operativas:

- `tgr deudas list` — deudas de impuestos **fiscales y aduaneros** (los cargos
  derivados de importaciones/DIN).
- `tgr cartola` — resumen de 12 meses: deudas por tipo, **estado de cobranza**
  (pre-judicial / judicial / quiebra) y convenios. **Experimental** (ver abajo).

> 🧪 **`tgr cartola` es experimental.** La aplicación de la cartola pasa por una página
> intermedia con **reCAPTCHA** (observado 2026-09-26). Esta herramienta **nunca interactúa
> con el desafío**: no hace clic, no lo resuelve, no lo automatiza; solo espera a que la
> página avance sola. Si la TGR muestra un desafío visible, la lectura falla, y así debe
> ser. Detalles en [`docs/tgr-contract/cartola-fiscal.md`](docs/tgr-contract/cartola-fiscal.md).

La sesión dura **alrededor de una hora** (medido: viva a los 58 min, muerta a los
68). Ver [`docs/ROADMAP.md`](docs/ROADMAP.md) y los contratos en
[`docs/tgr-contract/`](docs/tgr-contract/), que registran también lo que queda
abierto y lo que está verificado contra una sola cuenta.

## Estructura

```text
packages/
  core/   @dostertags/tgr-core   Núcleo de dominio (librería Node). Las superficies llaman solo a sus tasks.
  cli/    @dostertags/tgr-cli    CLI humana (terminal).
docs/                  Capa de contexto (ARCHITECTURE, CONVENTIONS, ADRs, wire contracts).
```

## Autenticación

La TGR usa **OAuth2 sobre AWS Cognito** con tres proveedores de identidad
federados, no un formulario RUT+Clave como el SII:

| IdP                    | Host del formulario                     | Automatizable sin humano                                   |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------- |
| Clave TGR              | `autentica.tgr.cl/idp/oauth2/authorize` | Sí (destino del camino headless, ADR-004)                  |
| Clave Tributaria (SII) | `www2.sii.cl/oauthsii-v1-org/`          | Desaconsejado — comparte el contador de bloqueo con el SII |
| ClaveÚnica             | `accounts.claveunica.gob.cl`            | **No** — reCAPTCHA; nunca se automatizará                  |

El login por defecto es **interactivo y agnóstico al IdP**: se abre el navegador
en la página real de la TGR y tú eliges con qué clave entrar. La clave nunca
llega al proceso ni a disco (ADR-003 / ADR-005).

## Instalación (desde el código)

```bash
git clone https://github.com/dostertags/tgr.git
cd tgr
pnpm install
pnpm build
pnpm --filter @dostertags/tgr-cli exec playwright install chromium
node packages/cli/dist/main.js --help     # o: cd packages/cli && pnpm link --global → `tgr`
```

## Desarrollo

```bash
pnpm install
pnpm build           # tsc -b
pnpm test            # vitest
pnpm lint
pnpm format
```

Requiere Node `>=20` y el pnpm fijado en `packageManager`. El login necesita
Chromium de Playwright:

```bash
pnpm --filter @dostertags/tgr-cli exec playwright install chromium
```

## Uso

```bash
tgr auth login              # abre el navegador en la página real de la TGR
tgr auth login --observe    # además captura la anatomía de la sesión (ADR-009)
tgr auth status             # lectura local: quién soy / ¿hay sesión?
tgr auth logout             # borra el estado local

tgr deudas list             # deudas de impuestos fiscales y aduaneros (cargos DIN)
tgr deudas list --human     # salida legible; por defecto es JSON

tgr cartola                 # resumen 12 meses: deudas por tipo, cobranza, convenios
```

## Códigos de salida

| Código | Significado                                                            |
| ------ | ---------------------------------------------------------------------- |
| 0      | OK                                                                     |
| 1      | Error genérico (p. ej. la página cambió de estructura)                 |
| 2      | Sin sesión / sesión expirada → `tgr auth login`                        |
| 3      | Login no completado                                                    |
| 4      | Bloqueo / límite de la TGR — **no reintentar**                         |
| 5      | Se intentó alcanzar una superficie de **pago** (nunca debería ocurrir) |
| 6      | La TGR no respondió a tiempo — transitorio, reintenta más tarde        |

## Limitaciones conocidas

- Verificado contra **una sola cuenta**, con casi todas las secciones en cero. Un
  parseo con cobranza o convenios poblados no está verificado.
- El portal de la TGR es lento y variable (de 10 a 64 s para la misma página);
  cada comando tarda típicamente entre 10 y 30 s.
- Hay una carrera conocida en la cartola: en una página que aún está cargando,
  las secciones opcionales podrían leerse vacías. Ver los pendientes en
  [`docs/tgr-contract/cartola-fiscal.md`](docs/tgr-contract/cartola-fiscal.md).
- Sin endpoint de logout en el servidor: `tgr auth logout` borra solo el estado local.

## Seguridad

Nunca subas secretos ni PII real (RUT, claves, cookies, nombres, montos). Las
capturas crudas de `--observe` están en `.gitignore`: solo un resumen revisado por
una persona entra a `docs/tgr-contract/`.

Para reportar una vulnerabilidad, ver [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE) © 2026 Diego Ostertag
