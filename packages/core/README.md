# @eleva/anchor-core

The engine behind [Anchor](https://github.com/eleva-builds/anchor): design
system parsing, context-file generation, and the deterministic lint rules.

Most people want the CLI instead:

```bash
npm install -g @eleva/anchor
```

This package is for building on top of Anchor — a custom reporter, an editor
integration, a different runner. It has no CLI concerns and performs no network
I/O.

```ts
import { parseAuto, lintFile, ALL_RULES, generateClaudeMd } from '@eleva/anchor-core';

const { designSystem } = parseAuto([{ path: 'tailwind.config.ts', content: source }]);

const { violations } = lintFile(
  { path: 'src/Button.tsx', content: componentSource },
  designSystem,
  ALL_RULES,
);

const claudeMd = generateClaudeMd(designSystem);
```

Two properties hold throughout the public API:

- **Nothing here reads from disk or executes the code it analyzes.** Parsers and
  the linter take file contents as text; the caller owns all I/O. That is what
  makes Anchor safe to run against untrusted pull requests.
- **The deterministic path makes no network calls.** The optional LLM layer is
  the only exception, and it is inert unless explicitly enabled.

Documentation lives in the [main repository](https://github.com/eleva-builds/anchor).

MIT © [Eleva Builds](https://elevabuilds.com)
