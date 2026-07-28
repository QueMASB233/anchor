# Anchor

**Make AI coding agents respect your design system.**

Anchor teaches Cursor, Claude Code and Codex what your design system actually is,
then enforces it on every pull request. The enforcement is deterministic — AST
analysis, no model in the loop, no network, nothing leaves your machine.

```
anchor lint

src/components/PricingPanel.tsx
  12:26  error    `p-[13px]` uses an arbitrary spacing value. Use `p-3` (12px) instead.
                  The scale is based on 4px steps.                     no-arbitrary-spacing
  18:45  error    `#64748b` is a hard-coded colour. It matches the token
                  `muted-foreground`; use that instead.                  no-raw-hex-colors
  20:7   error    A Card inside a Card doubles the padding, border and
                  elevation. Use a section instead.                      composition-rules
  23:17  error    `Button` has no `variant` variant called `primry`.
                  Allowed: `primary`, `secondary`, `ghost`.
                  Did you mean `primary`?                        valid-component-variants

7 errors, 3 warnings in 4 files (30ms)
5 of these can be fixed automatically — run `anchor lint --fix`
```

---

## Why

Coding agents write plausible UI code. Plausible is the problem: `p-[13px]`
looks fine in isolation, `bg-[#2D3748]` renders correctly, and a typo'd
`variant="primry"` silently falls back to the default styling. None of it fails
a build. All of it drifts your product away from its design system, one
reasonable-looking pull request at a time.

Anchor closes both ends of that loop. `anchor sync` gives the agent the design
system up front so it writes on-system code the first time. `anchor lint` checks
what it actually wrote.

## Install

> **Not published to npm yet.** `npm install -g @eleva/anchor` returns a 404
> until the first release lands. Build from source in the meantime — it takes
> about a minute.

<details open>
<summary><strong>From source (works today)</strong></summary>

```bash
git clone https://github.com/eleva-builds/anchor.git
cd anchor
corepack enable pnpm      # if you do not have pnpm
pnpm install
pnpm run build

# Put `anchor` on your PATH
cd packages/cli && npm link
```

`anchor --version` should now work from any directory. To remove it later:
`npm unlink -g @eleva/anchor`.

Rebuild with `pnpm run build` after pulling changes; the link points at the
build output, so it picks them up automatically.

</details>

<details>
<summary><strong>Once published</strong></summary>

```bash
npm install -g @eleva/anchor
```

</details>

## Quickstart

In a repository with a Tailwind config and a components folder:

```bash
anchor init     # detect the design system, write a starter config
anchor sync     # generate CLAUDE.md, .cursorrules and AGENTS.md
anchor lint     # check your components
```

`init` reports what it found, so you know immediately whether Anchor understood
your project:

```
Looking for your design system...

   Tailwind CSS  ·  tailwind.config.ts
   318 tokens  ·  249 colours, 7 spacing steps
   4px base unit, inferred from your scale
   6 components with variants, read from your source

Wrote anchor.config.json
```

Anchor works with no configuration in a conventional project. The config file
exists so you can be explicit, not because you have to be.

## What `sync` generates

`anchor sync` writes three files, each in the format its tool expects:

| File           | Read by                                         |
| -------------- | ----------------------------------------------- |
| `CLAUDE.md`    | Claude Code                                     |
| `.cursorrules` | Cursor                                          |
| `AGENTS.md`    | Codex and other agents following the convention |

They contain your spacing scale and its base unit, your colour tokens with
semantic tokens listed first, your component variants, your composition rules,
and the rules that will be enforced on the pull request.

Three properties matter:

- **Generated content lives inside markers.** Anything you wrote outside them is
  preserved byte for byte, so `sync` is safe to run on a `CLAUDE.md` you already
  maintain.
- **Output is deterministic.** The same design system produces identical bytes,
  so `sync` in a pre-commit hook does not churn your diff.
- **Output is summarized, not dumped.** A full Tailwind theme carries 247
  colours; listing them all would bury the rules that change agent behaviour
  under a wall of hex codes. Palettes are summarized by family, semantic tokens
  are spelled out. A complete Tailwind theme renders to about 5 KB.

## Rules

| Rule                       | Default | Fixable | Catches                                          |
| -------------------------- | ------- | ------- | ------------------------------------------------ |
| `no-arbitrary-spacing`     | error   | yes     | `p-[13px]`, `gap-[7px]` — anything off the scale |
| `no-raw-hex-colors`        | error   | partial | `bg-[#2D3748]`, hex in a `style` object          |
| `use-design-tokens`        | warning | yes     | `text-gray-500` where `text-secondary` exists    |
| `no-inline-styles`         | error   | no      | `style={{ ... }}`                                |
| `valid-component-variants` | error   | yes     | `<Button variant="primry">`                      |
| `composition-rules`        | error   | no      | `Card` inside `Card`, and your own rules         |
| `no-custom-shadows`        | warning | partial | `shadow-[0_4px_8px_...]`                         |
| `heading-order`            | warning | no      | `h1` followed by `h3`                            |

Fixability is a claim Anchor tries to earn rather than assume.
`no-arbitrary-spacing` is automatic because "nearest value on the scale" is
unambiguous. `no-raw-hex-colors` is only automatic when the hex matches a token
exactly — otherwise there is no correct answer, and suggesting the visually
nearest colour would silently change your design. `no-inline-styles` is never
automatic, because removing one means deciding where the value belongs.

Every rule can be reconfigured or turned off:

```json
{
  "rules": {
    "use-design-tokens": "off",
    "no-arbitrary-spacing": { "severity": "warning", "options": { "tolerancePx": 1 } }
  }
}
```

Or suppressed inline:

<!-- prettier-ignore -->
```tsx
{/* anchor-disable-next-line no-arbitrary-spacing */}
<div className="p-[13px]" />
```

## Token formats

Anchor auto-detects all of these and normalizes them to one internal model, so
the rules and the generated files are identical whichever you use.

- **Tailwind CSS** — both v3 (`tailwind.config.js`) and v4 (`@theme` in CSS)
- **Style Dictionary**
- **W3C Design Tokens** (DTCG)
- **Figma Variables** — the raw REST API export
- **CSS custom properties** — including shadcn/ui's bare HSL triplets

Component variants are read from your source. If you use
`class-variance-authority` — as shadcn/ui does — Anchor extracts the variants
statically, so `valid-component-variants` works without you writing an inventory
by hand.

## GitHub Action

```yaml
name: Design system

on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  anchor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: eleva-builds/anchor-lint@v1
        with:
          strict: true
          comment: true
```

Violations appear inline on the diff, and Anchor posts one summary comment which
it updates in place on each push rather than adding another.

`strict: true` fails the job on errors; warnings never fail it. Being unable to
post a comment never fails the job either — the annotations are already on the
diff, and a check that goes red over a permissions setting just teaches people
to delete the check.

## Working on only what changed

```bash
anchor lint --since main
```

Useful when adopting Anchor in an existing codebase: hold the line on new code
without having to fix everything first.

## Privacy

Anchor runs entirely on your machine or your own CI runner.

- **Your design system never leaves your repository.** No upload, no sync
  service, no account.
- **No network calls** in the linting path. Anchor works on a plane.
- **No telemetry.** Not on by default, not off by default — it does not exist.
- **Anchor never executes the code it analyzes.** Files are read as text and
  parsed to an AST. This is what makes it safe to run against untrusted pull
  requests, and it is enforced rather than promised: reading a
  `tailwind.config.js` is done by static analysis, and the Action refuses the
  one opt-in escape hatch outright.

An optional bring-your-own-key layer can add written suggestions on top of the
violations Anchor already found. It is off unless you explicitly enable it, and
pointing it at [Ollama](https://ollama.com) keeps everything local. Code is
passed through a secret-redaction pass before transmission, and only a window
around each violation is sent — never the file.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Examples

Three runnable projects, one per token format:

- [`examples/tailwind-shadcn`](examples/tailwind-shadcn) — Tailwind and
  shadcn/ui, with an on-system file and an off-system one for comparison
- [`examples/style-dictionary`](examples/style-dictionary) — Style Dictionary
  tokens with aliases
- [`examples/figma-variables`](examples/figma-variables) — a raw Figma REST
  export

```bash
cd examples/tailwind-shadcn
anchor lint
```

## Configuration

Anchor uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so any of
`anchor.config.json`, `anchor.config.js`, `.anchorrc`, or an `anchor` key in
`package.json` works.

```json
{
  "name": "Acme Design System",
  "tokens": ["tailwind.config.ts"],
  "components": ["src/components/**/*.tsx"],
  "include": ["src/**/*.tsx"],
  "exclude": ["**/*.stories.tsx"],
  "rules": {
    "no-inline-styles": "warning"
  },
  "designSystem": {
    "compositionRules": [
      {
        "id": "no-nested-card",
        "parent": "Card",
        "forbiddenDescendants": ["Card"],
        "severity": "error"
      }
    ]
  }
}
```

Full reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Commands

```
anchor init                      set up in an existing project
anchor sync                      generate the agent context files
anchor sync --check              fail if they are out of date (for CI)
anchor lint                      check everything
anchor lint --since main         check only what this branch changed
anchor lint --fix                apply the fixes that are safe to apply
anchor lint --strict             exit 1 on any error
anchor lint --format sarif       for GitHub code scanning
```

`lint` exits 0 without `--strict`, so you can adopt it before you are ready to
block merges.

## Requirements

Node.js 20.11 or newer. TSX and JSX are supported today; the parser layer is
structured so Vue and Svelte can be added without touching rule logic.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The architectural invariants — never
execute the analyzed code, no network in the deterministic path, never log
secrets — are not style preferences, and a change that breaks one will not be
merged.

## License

MIT © [Eleva Builds](https://elevabuilds.com)
