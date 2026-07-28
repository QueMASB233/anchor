# Contributing to Anchor

Thanks for helping build Anchor. This guide covers getting set up, the conventions we hold to, and how changes get released.

## Prerequisites

- **Node.js 20.11+** (`.nvmrc` pins 20; CI also tests 22 and 24)
- **pnpm 9** — `corepack enable pnpm` is enough, the version is pinned in `package.json`

## Getting started

```bash
git clone https://github.com/eleva-builds/anchor.git
cd anchor
pnpm install
pnpm run check
```

`pnpm run check` runs format, lint, typecheck, and tests — the same gates CI enforces. Run it before opening a PR.

## Repository layout

| Path              | Package              | Purpose                                                       |
| ----------------- | -------------------- | ------------------------------------------------------------- |
| `packages/core`   | `@eleva/anchor-core` | Parsers, generators, rule engine, reporters. No CLI concerns. |
| `packages/cli`    | `@eleva/anchor`      | Commander wrapper: arg parsing, config discovery, exit codes. |
| `packages/action` | (private)            | GitHub Action wrapping the CLI.                               |
| `examples/`       | —                    | Runnable example repos used by docs and E2E tests.            |
| `docs/`           | —                    | Documentation site source.                                    |

The dependency direction is strictly `action → cli → core`. Core must never import from cli or action.

## Common commands

```bash
pnpm run build          # build all packages (turbo, cached)
pnpm run test           # run all tests once
pnpm run test:watch     # vitest watch mode across the workspace
pnpm run typecheck      # tsc --noEmit in every package
pnpm run lint           # eslint
pnpm run format         # prettier --write
```

Scope any command to one package with `--filter`:

```bash
pnpm --filter @eleva/anchor-core run test
```

## Non-negotiable rules

These are architectural invariants, not style preferences. A PR that breaks one will not be merged.

1. **Never execute the code being linted.** No `import`, `require`, `eval`, or `new Function` against target files. Parse to an AST and read it. ESLint enforces the obvious primitives; reviewers enforce the rest. See [SECURITY.md](SECURITY.md).
2. **The deterministic engine makes no network calls.** Parsing, linting, and reporting must work fully offline. The LLM layer is strictly additive and never a dependency of the core path.
3. **Never log secrets.** API keys and license keys stay in memory.
4. **No secrets in the repo.** Add new configuration to `.env.example` with an empty value.
5. **`any` requires a justification comment** explaining why a precise type is not possible.
6. **Every new lint rule ships with fixture tests** — a clean file producing zero violations, and a dirty file producing exactly the expected set.

## Adding a lint rule

1. Create `packages/core/src/rules/<rule-id>.ts` implementing the base `Rule` interface.
2. Register it in `packages/core/src/rules/index.ts`.
3. Add fixtures under `packages/core/tests/fixtures/rules/<rule-id>/` — at minimum `clean.tsx` and `dirty.tsx`.
4. Add the rule's default severity and options to the config schema.
5. Document it in the README's rule table.

Rules must be individually toggleable and severity-overridable via `anchor.config`.

## Adding a token parser

Every parser normalizes to the same `DesignSystem` model and validates its output with the zod schema at the boundary. Add fixtures from a real-world token file, not a hand-written minimal one — the value is in handling what teams actually have.

## Commits and pull requests

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

Any change affecting a published package needs a changeset:

```bash
pnpm changeset
```

Pick the affected packages and a bump level, and describe the change in terms a user would recognize — the text lands in the changelog. Bug fixes are `patch`, new backward-compatible capability is `minor`, anything breaking is `major`. Changes touching only `examples/`, `docs/`, or CI do not need one.

## Releasing

Maintainers only. Merging to `main` with pending changesets opens a "Version Packages" PR; merging that PR publishes to npm with provenance. The action bundle in `packages/action/dist` is committed and verified fresh by CI — rebuild and commit it whenever action code changes.

## Reporting security issues

Do not open a public issue. Follow the process in [SECURITY.md](SECURITY.md).

## License

Contributions are licensed under the MIT License, matching the project.
