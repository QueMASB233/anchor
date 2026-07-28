# Security Policy

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/eleva-builds/anchor/security/advisories/new), or by email to **security@elevabuilds.com**.

Please include the affected version, reproduction steps, and the impact you believe it has. If you would like a PGP key for the email route, ask and we will supply one.

**What to expect:**

| Stage              | Target                           |
| ------------------ | -------------------------------- |
| Acknowledgement    | within 48 hours                  |
| Initial assessment | within 5 business days           |
| Fix or mitigation  | within 30 days for high/critical |

We will keep you updated throughout, credit you in the advisory unless you prefer otherwise, and coordinate disclosure timing with you. We do not currently run a paid bug bounty.

## Supported versions

During pre-1.0 development, only the latest published minor version receives security fixes.

## Threat model

Anchor's central promise is that **your design system and your source code never leave your machine**. The properties below are what that promise rests on. A break in any of them is a security vulnerability, not a bug — please report it through the process above.

### 1. Anchor never executes the code it analyzes

The linter reads target files as text and parses them to an AST. It does **not** `import`, `require`, `eval`, or otherwise execute any file in the project being linted, and it does not run that project's build, plugins, or lifecycle scripts.

This matters most in CI, where Anchor runs against pull request contents that are attacker-controlled. A malicious PR must not be able to achieve code execution on a runner simply by being linted.

The one deliberate exception: `tailwind.resolveConfig` (CLI: `--unsafe-resolve-config`) loads `tailwind.config.js` in a sandboxed child process to resolve dynamic configs accurately. It is **off by default**, and **hard-disabled inside the GitHub Action** — the Action ignores the flag entirely regardless of config, because PR contents cannot be trusted. Never enable it against a repository you do not trust.

### 2. No network access in the default path

The deterministic engine — parsing, generation, linting, reporting — makes zero network calls. Anchor works fully offline. There is no telemetry, no analytics, and no license phone-home.

Network access is possible in exactly one place: the optional LLM layer, which is inert unless you explicitly set `llm.enabled: true` **and** supply a key or a local endpoint. When enabled, code snippets are passed through a secret-redaction pass before transmission. For a configuration where nothing leaves your machine at all, use the Ollama provider.

### 3. License verification is offline and signature-only

**Nothing in Anchor is gated today.** Every capability it ships is free, and the entitlement check returns the same feature set with or without a license. The machinery below exists so that adding a commercial tier later would be an addition rather than a refactor; see [docs/PAID-TIER.md](docs/PAID-TIER.md).

If a license is ever issued, it is carried in an Ed25519-signed key verified locally against a public key compiled into the build. Anchor never contacts a licensing server. The public key currently shipped is a deliberate placeholder, so no key verifies at all — the safe failure direction. The matching private key does not exist yet, and when it does it will live on offline signing infrastructure: not in this repository, not in CI, not in any published artifact.

Note that offline signature verification is designed to establish _entitlement_, not to resist a determined user patching their own local copy. That is an accepted trade-off in an open-source client.

### 4. Secrets are never logged

API keys are read from config or environment and held in memory only. They are never written to logs, cache files, reports, or error messages.

## Out of scope

The following are not treated as vulnerabilities in Anchor:

- A user voluntarily enabling `llm.enabled` and sending their own code to a provider they chose.
- A user enabling `--unsafe-resolve-config` on a repository they do not trust, outside the Action.
- Patching a local build to bypass license checks (see note in §3).
- Vulnerabilities in a project _being linted_, unless Anchor amplifies them.
