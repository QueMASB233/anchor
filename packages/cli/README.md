# @eleva/anchor

**Make AI coding agents respect your design system.**

Anchor teaches Cursor, Claude Code and Codex what your design system actually
is, then enforces it on every pull request. The enforcement is deterministic —
AST analysis, no model in the loop, no network, nothing leaves your machine.

```bash
npm install -g @eleva/anchor
```

> If this returns a 404, the first release has not landed yet. Build from source:
> see the [repository README](https://github.com/eleva-builds/anchor#install).

## Quickstart

In a repository with a Tailwind config and a components folder:

```bash
anchor init     # detect the design system, write a starter config
anchor sync     # generate CLAUDE.md, .cursorrules and AGENTS.md
anchor lint     # check your components
```

## What it catches

```
src/components/PricingPanel.tsx
  12:26  error    `p-[13px]` uses an arbitrary spacing value. Use `p-3` (12px) instead.
                  The scale is based on 4px steps.                     no-arbitrary-spacing
  18:45  error    `#64748b` is a hard-coded colour. It matches the token
                  `muted-foreground`; use that instead.                  no-raw-hex-colors
  23:17  error    `Button` has no `variant` variant called `primry`.
                  Did you mean `primary`?                        valid-component-variants

7 errors, 3 warnings in 4 files (30ms)
5 of these can be fixed automatically — run `anchor lint --fix`
```

Eight rules cover spacing, colour, semantic tokens, inline styles, component
variants, composition, shadows and heading order. Each is individually
configurable.

## Token formats

Tailwind (v3 and v4), Style Dictionary, W3C design tokens, Figma variables and
CSS custom properties, all auto-detected. Component variants are read statically
from `class-variance-authority`, so shadcn/ui projects work with no inventory
written by hand.

## Privacy

Anchor runs entirely on your machine or your own CI runner. Your design system
never leaves your repository, there is no telemetry, and the linter never
executes the code it analyzes — files are read as text and parsed to an AST.

## Documentation

Full README, rule reference, configuration reference and the GitHub Action:
**https://github.com/eleva-builds/anchor**

MIT © [Eleva Builds](https://elevabuilds.com)
