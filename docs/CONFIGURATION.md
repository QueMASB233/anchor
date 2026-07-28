# Configuration reference

Anchor works with no configuration in a conventional project. Everything below
is optional.

Configuration is discovered with [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig),
so any of these work, in this order of precedence:

```
package.json          ("anchor" key)
.anchorrc[.json|.yaml|.yml|.js|.cjs|.mjs]
anchor.config.json
anchor.config.[js|cjs|mjs|ts]
```

Every field is validated on load. An unknown key or a misspelled rule id is an
error rather than something silently ignored, because a rule you believe is
enforced and is not is worse than no rule at all.

---

## Sources

### `tokens`

`string | string[]` — globs pointing at your design tokens, relative to the
project root.

```json
{ "tokens": ["tailwind.config.ts"] }
```

When omitted, Anchor looks in conventional locations (`tailwind.config.*`,
`src/**/*.css`, `tokens/**/*.json`, and similar) and auto-detects the format.
Only conventional locations are searched, so a stray JSON file deep in the
repository is never mistaken for a design system.

### `components`

`string | string[]` — globs pointing at component source, used to extract
variant definitions.

```json
{ "components": ["src/components/**/*.tsx"] }
```

Anchor reads `class-variance-authority` (and `tailwind-variants`) definitions
statically. This is what makes `valid-component-variants` work without a
hand-written inventory. Nothing is executed.

### `name`

`string` — display name for the design system, used in generated files. Defaults
to whatever the parser inferred.

### `rootFontSize`

`number` — the root font size used to resolve `rem` values into pixels. Defaults
to `16`.

---

## What gets linted

### `include`

`string[]` — files `anchor lint` checks. Defaults to
`["src/**/*.{tsx,jsx}", "app/**/*.{tsx,jsx}"]`.

### `exclude`

`string[]` — globs to skip, in addition to the always-excluded
`node_modules`, `dist`, `build`, `.next`, `coverage` and `*.d.ts`.

```json
{ "exclude": ["**/*.stories.tsx", "**/*.test.tsx"] }
```

### `classHelpers`

`string[]` — functions whose string arguments should be treated as class names.

Anchor already follows `cn`, `clsx`, `classnames`, `classNames`, `cva`, `cx`,
`tv`, `twMerge`, `twJoin` and `tw`. Add your own if you wrap them:

```json
{ "classHelpers": ["styles", "myCn"] }
```

---

## Rules

`rules` — an object keyed by rule id. Each value is either a severity, or an
object with a severity and options.

```json
{
  "rules": {
    "use-design-tokens": "off",
    "no-custom-shadows": "error",
    "no-arbitrary-spacing": {
      "severity": "warning",
      "options": { "tolerancePx": 1 }
    }
  }
}
```

Severities are `"error"`, `"warning"` and `"off"`. Only errors can fail a run,
and only under `--strict`.

### Rule options

| Rule                   | Option              | Default | Effect                                                |
| ---------------------- | ------------------- | ------- | ----------------------------------------------------- |
| `no-arbitrary-spacing` | `tolerancePx`       | `0`     | Allow values within this many pixels of a scale value |
| `no-inline-styles`     | `allowDynamic`      | `true`  | Permit style objects with no static values            |
| `no-inline-styles`     | `allowCssVariables` | `true`  | Permit `style={{ '--progress': pct }}`                |
| `heading-order`        | `requireH1`         | `false` | Require the first heading in a file to be `h1`        |

`allowDynamic` and `allowCssVariables` default to permissive on purpose. There is
no static answer for a computed width, and CSS custom properties are the
sanctioned way to pass a runtime value into CSS. Flagging either would mostly
teach people to suppress the rule.

### Inline suppression

<!-- prettier-ignore -->
```tsx
{/* anchor-disable-next-line no-arbitrary-spacing */}
<div className="p-[13px]" />

<div className="p-[13px]" /> {/* anchor-disable-line */}

/* anchor-disable */
// ...
/* anchor-enable */

// anchor-disable-file no-inline-styles
```

Listing rule ids narrows the suppression. Omitting them suppresses every rule at
that location.

---

## Design system facts that no token file carries

`designSystem` — for structure that cannot be expressed in tokens.

### `designSystem.components`

Declare components explicitly. Config always wins over anything extracted from
source, so this is how you correct or extend what Anchor inferred.

```json
{
  "designSystem": {
    "components": {
      "Button": {
        "name": "Button",
        "variants": { "variant": ["primary", "secondary"], "size": ["sm", "md"] },
        "requiredProps": ["children"],
        "source": "config"
      }
    }
  }
}
```

`size` is just another variant dimension. Any dimension your components use —
`tone`, `density` — works without a change to Anchor.

### `designSystem.compositionRules`

```json
{
  "designSystem": {
    "compositionRules": [
      {
        "id": "no-nested-card",
        "parent": "Card",
        "forbiddenDescendants": ["Card"],
        "severity": "error",
        "message": "A Card inside a Card doubles the padding and elevation."
      },
      {
        "id": "list-children",
        "parent": "List",
        "allowedChildren": ["ListItem"],
        "severity": "error"
      }
    ]
  }
}
```

The distinction between `forbiddenDescendants` and `forbiddenChildren` is
load-bearing. "A Card must not contain a Card" has to survive arbitrary wrapper
elements, so it is checked against the whole ancestor chain. "A List accepts only
ListItem children" is about direct children only — and Anchor sees through
fragments, conditionals and `.map()` callbacks when checking them.

`message` replaces the generated text. Write it for the developer who hits it.

### `designSystem.antiPatterns`

Project-specific prohibitions the built-in rules do not cover.

```json
{
  "designSystem": {
    "antiPatterns": [
      {
        "id": "no-legacy-modal",
        "description": "LegacyModal is being retired in Q3.",
        "fix": "Use `Dialog`.",
        "matcher": { "kind": "jsx-element", "element": "LegacyModal" },
        "severity": "warning"
      }
    ]
  }
}
```

Matchers are declarative data with no callback or expression form. In the GitHub
Action this configuration comes from the pull request being linted, so a matcher
that could execute would be remote code execution on the runner. Available
matcher kinds:

| `kind`                  | Fields                               | Matches                                      |
| ----------------------- | ------------------------------------ | -------------------------------------------- |
| `jsx-element`           | `element`, `withProp?`, `propValue?` | A JSX element, optionally narrowed by a prop |
| `class-name-regex`      | `pattern`, `flags?`                  | A class name anywhere in the file            |
| `inline-style-property` | `property`                           | A property in an inline style object         |
| `import-source`         | `source`, `imported?`                | An import from a module                      |

Regex patterns are capped in length, rejected if they nest unbounded quantifiers
(`(a+)+`), and may not use the stateful `g` and `y` flags.

---

## Generated files

`generators` — controls what `anchor sync` writes.

```json
{
  "generators": {
    "claudeMd": true,
    "cursorrules": false,
    "agentsMd": "docs/AGENTS.md",
    "extraInstructions": "Always use the `cn()` helper for conditional classes.",
    "maxTokensPerGroup": 48
  }
}
```

Each target accepts `true`, `false`, or a path. `extraInstructions` is appended
verbatim to every generated file. `maxTokensPerGroup` caps how many entries are
listed per token group before the rest are summarized.

---

## Tailwind

```json
{ "tailwind": { "resolveConfig": false } }
```

`resolveConfig` loads `tailwind.config.js` in a sandboxed child process for full
accuracy with dynamic configs. It is **off by default and ignored entirely
inside the GitHub Action**, where the config comes from the pull request being
linted. Never enable it against a repository you do not trust.

By default the config is read by static analysis, which cannot follow
`require('tailwindcss/colors')`, spreads of imported objects, or function-valued
theme keys. Anchor warns about each one it skips, with a file and line, rather
than silently missing tokens.

---

## Optional LLM suggestions

```json
{
  "llm": {
    "enabled": true,
    "provider": "ollama",
    "model": "llama3.1"
  }
}
```

Off unless `enabled` is exactly `true`. A key present in your environment for
some other tool will not turn this on.

| Field            | Default          | Notes                                                       |
| ---------------- | ---------------- | ----------------------------------------------------------- |
| `enabled`        | `false`          | Must be literally `true`                                    |
| `provider`       | `"ollama"`       | `anthropic`, `openai`, `deepseek`, `ollama`                 |
| `model`          | provider default |                                                             |
| `apiKey`         | —                | Prefer the environment variable; config files get committed |
| `baseUrl`        | provider default | For a self-hosted or proxied endpoint                       |
| `timeoutMs`      | `20000`          | Past this, the suggestion is dropped                        |
| `maxSuggestions` | `10`             | Errors are prioritised over warnings                        |
| `contextLines`   | `4`              | Lines of surrounding code sent per violation                |

Keys are read from `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`.
Ollama needs none.

Suggestions never change a violation, a count, or an exit code. A timeout or an
outage costs a suggestion, nothing more.

---

## Caching

`cacheDir` — where the parsed design system is cached. Defaults to `.anchor`.

The cache key is a content hash of your token files, your configuration and the
Anchor version, so a branch switch that does not change tokens is still a hit,
and a version bump invalidates it. `--no-cache` skips it. The directory
gitignores itself.
