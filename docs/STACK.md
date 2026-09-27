# Tech Stack

Ported wholesale from the `sii` monorepo — it is proven, and gratuitous
divergence between two companion tools costs more than it buys.

| Concern            | Choice                                                                                | Notes                                                  |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Language           | TypeScript 5.6+, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `tsconfig.base.json`                                   |
| Runtime            | Node ≥ 20, ESM (`"type": "module"`)                                                   | `engine-strict=true`                                   |
| Modules            | `NodeNext` resolution, `verbatimModuleSyntax`                                         | explicit `.js` specifiers in relative imports          |
| Package manager    | pnpm workspaces                                                                       | `packages/*`, `tools/*`                                |
| Build              | `tsc -b` project references                                                           | composite builds, declaration maps                     |
| Tests              | vitest                                                                                | `packages/*/src/**/*.test.ts`, colocated               |
| Lint / format      | eslint (typescript-eslint) + prettier                                                 | `consistent-type-imports` enforced                     |
| CLI framework      | commander                                                                             | thin surface over core tasks                           |
| Browser automation | Playwright (Chromium) — **optional peer of core**                                     | only `adapters/node/portal.ts` imports it              |
| Validation         | zod                                                                                   | for parsing portal responses, once read surfaces exist |

## What is deliberately absent

- **No MCP server yet.** v1 is CLI-only (ADR-008 scope). The core→surfaces
  boundary is already proven in `sii`, so adding MCP later carries no design risk.
- **No HTTP client library.** Authenticated requests ride the browser context;
  unauthenticated ones use Node's global `fetch`.
- **No third-party TGR/Chile-tax library.** Everything is first-hand observation
  (CONVENTIONS).
- **No `@dostertags/sii-core` dependency.** ADR-001.
