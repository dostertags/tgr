# Security Policy

This project automates **read-only** interactions with Chile's Tesorería General de la
República (TGR) and handles session cookies and personal tax data. Security and privacy
are core to its design (see [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) §"Security & PII"
and [ADR-006](docs/decisions/006-read-only-by-construction.md)).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting — the **"Report a vulnerability"** button
under the repository's **Security** tab
(<https://github.com/dostertags/tgr/security/advisories/new>) with:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof of concept if possible),
- affected version / commit.

Please allow a reasonable window to investigate and ship a fix before any public
disclosure. This is a personal open-source project, so responses are best-effort rather
than bound by an SLA.

## Scope

In scope: the `@dostertags/tgr-core` library and the `@dostertags/tgr-cli` in this
repository — in particular anything that could make the tool **move money or reach a
payment surface** (ADR-006), credential handling, session storage, the audit log, or PII
exposure.

Out of scope: TGR's own systems and any third-party service. Do **not** test against
accounts you do not own, and never attempt to bypass TGR's access controls or bot checks.

## Handling data

Never paste real RUTs, cookies, razón social, amounts or `~/.tgr/` contents into issues,
pull requests or logs. Use synthetic Mod-11-valid RUTs (e.g. `77777777-7`).
