# Decision Log

Decisions get an ADR **before** implementation. Use `TEMPLATE.md`.

| ADR                                                        | Title                                                                  | Status                 |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------- |
| [001](001-separate-repo-port-patterns.md)                  | Separate repo — port the `sii` patterns, do not import `sii-core`      | Accepted               |
| [002](002-stack-and-core-surfaces-layout.md)               | Stack and layout — TypeScript, pnpm monorepo, core + thin surfaces     | Accepted               |
| [003](003-idp-agnostic-login-terminal-origin-detection.md) | IdP-agnostic interactive login; success = terminal app origin          | Accepted               |
| [004](004-headless-credential-path-clave-tgr.md)           | Headless credential path targets Clave TGR, never ClaveÚnica           | Accepted (impl. v1.1)  |
| [005](005-session-cookies-only-first.md)                   | Cookies-only session first; escalate to a key allowlist only if forced | Accepted (provisional) |
| [006](006-read-only-by-construction.md)                    | Read-only by construction — no payment surface, enforced by a test     | Accepted               |
| [007](007-scope-tgr-only.md)                               | Scope is TGR only — Aduanas is out                                     | Accepted               |
| [008](008-single-principal-identity.md)                    | Single-principal identity (empresa) — no `operate` pointer             | Accepted               |
| [009](009-session-anatomy-capture-in-login.md)             | Session-anatomy capture inside the login flow, behind a widened seam   | Accepted               |
| [010](010-identity-from-cartola-handoff-link.md)           | Read the principal's identity from the cartola hand-off link           | Accepted               |
| [011](011-embedded-app-reads-and-the-tipopago-gate.md)     | Embedded-app reads; the one POST this tool may make                    | Accepted               |

## Open items tracked by these ADRs

Resolved 2026-08-10 by the first live login (see `docs/tgr-contract/auth-login.md`):

| Item                                      | ADR | Answer                                                                        |
| ----------------------------------------- | --- | ----------------------------------------------------------------------------- |
| Does a cookies-only jar restore?          | 005 | **Yes.** Server-side exchange; no tokens in storage. No allowlist needed.     |
| Exact terminal URL of a successful login  | 003 | `www.tesoreria.cl/LoginPortalCognito/null` — a 404. TGR's redirect is broken. |
| Is the origin allowlist a valid signal?   | 003 | **No** — amended. Origin + path, plus a `userCognito` post-condition.         |
| Does the email challenge appear?          | 003 | Not triggered in two logins (scaffold present on the SII IdP).                |
| Where does the principal's RUT come from? | 008 | The cartola hand-off link — see ADR-010. Also yields razón social + IdP.      |

Still open:

| Item                                                    | ADR       | Resolved by                                                                            |
| ------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| `FORMULARIO` code space (which are aduaneros?)          | 011       | an account with more than one debt row                                                 |
| DataTables pagination on the deudas grid                | 011       | an account whose listing spans pages                                                   |
| Cartola: the Pagos/Pendientes split (identical headers) | 011       | a second account, or a distinguishing attribute                                        |
| `FORMULARIO` code meanings                              | 011       | the folio detail view — crosses ADR-011's "stop at the listing" line, needs a decision |
| Server-side logout endpoint                             | —         | none identified; `logout` wipes local state only                                       |
| Does Clave TGR support **empresa** RUTs?                | 004 / 008 | user creating the credential                                                           |

Resolved 2026-08-11 by ADR-011: "Generar Cupón de Pago" is **out of scope** — generating a cupón
is not performed. Selecting the non-payment `tipoPago` mode in order to reach a consulta screen is
not generating one, and is the single POST this tool is permitted to make.
