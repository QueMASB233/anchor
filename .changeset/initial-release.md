---
'@eleva/anchor-core': minor
'@eleva/anchor': minor
---

First public release.

`anchor sync` generates CLAUDE.md, .cursorrules and AGENTS.md from a team's
design system, so coding agents write on-system code from the start.
`anchor lint` checks what they wrote, deterministically and offline, with eight
rules covering spacing, colour, tokens, inline styles, component variants,
composition, shadows and heading order.

Six token formats are auto-detected: Tailwind v3 and v4, Style Dictionary, W3C
design tokens, Figma variables, and CSS custom properties. Component variants
are extracted statically from `class-variance-authority`.

The linter never executes the code it analyzes, makes no network calls, and
sends no telemetry. A GitHub Action reports violations inline on pull requests.
An optional bring-your-own-key layer can add written suggestions; it is off
unless explicitly enabled.
