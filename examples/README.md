# Examples

Three runnable projects, one per token format. Each is a real directory Anchor
can be pointed at, not a snippet.

| Directory                              | Format                  | Shows                                                                                 |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| [`tailwind-shadcn`](tailwind-shadcn)   | Tailwind v3 + shadcn/ui | Variants read from `cva`, a composition rule, an on-system file and an off-system one |
| [`style-dictionary`](style-dictionary) | Style Dictionary        | Nested groups, `{alias.references}`, semantic tokens over palette values              |
| [`figma-variables`](figma-variables)   | Figma Variables         | A raw REST export, 0–1 RGBA floats, `VARIABLE_ALIAS`                                  |

Run any of them:

```bash
cd examples/tailwind-shadcn
anchor lint
```

In `tailwind-shadcn`, `src/on-system.tsx` and `src/off-system.tsx` render the
same panel. The first produces no violations; the second is the version a coding
agent tends to write before it has read `CLAUDE.md`. Diffing them is the fastest
way to see what Anchor is for.

These directories are also used by the end-to-end tests, so they stay correct.
