# Anchor

**Make AI coding agents respect your design system.**

Anchor teaches Cursor, Claude Code, Codex, and friends what your design system actually is — then enforces it on every pull request, deterministically, with no model in the loop.

> **Status: pre-alpha, under active construction.** The monorepo scaffolding is in place; packages are being built out. This README is a placeholder and will be replaced with the real quickstart, rule reference, and Action snippet in the final build step. Not yet published to npm.

## What it does

| Command       | What it does                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anchor sync` | Reads your design system in whatever format you already have, and generates `CLAUDE.md`, `.cursorrules`, and `AGENTS.md` so agents write on-system code from the start. |
| `anchor lint` | Parses your components via AST and reports every design system violation with file, line, rule, and a suggested fix.                                                    |
| GitHub Action | Runs `anchor lint` on every PR, annotates the diff, and blocks merges on errors when you want it to.                                                                    |

## Privacy

Anchor runs entirely on your machine or your own CI runner.

- **Your design system never leaves your repo.** No upload, no sync service, no account.
- **No network calls** in the linting path. Anchor works on a plane.
- **No telemetry.** Not on by default, not off by default — it does not exist.
- **Never executes your code.** Files are read as text and parsed to an AST, which is what makes Anchor safe to run against untrusted pull requests.

An optional bring-your-own-key LLM layer can add semantic suggestions on top. It is off unless you explicitly enable it, and pointing it at [Ollama](https://ollama.com) keeps everything local.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Eleva Builds](https://elevabuilds.com)
