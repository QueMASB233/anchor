/**
 * Stripping secrets out of code before it is transmitted.
 *
 * HONEST SCOPE
 * ------------
 * This is a safety net, not a guarantee. Pattern matching cannot recognise
 * every secret a codebase might contain, and anything claiming otherwise is
 * selling something. The real protections are structural and sit upstream:
 * the LLM layer is off unless a user explicitly turns it on, and the
 * recommended provider is Ollama, which never leaves the machine.
 *
 * What this does buy is the common case. A component file that happens to
 * contain a hard-coded key — because someone was debugging, or because the
 * snippet window reached a neighbouring line — should not carry that key to a
 * third party just because a developer wanted a nicer lint suggestion.
 *
 * Patterns are matched by shape rather than by provider name where possible,
 * so a key format Anchor has never heard of still stands a chance.
 */

export interface RedactionResult {
  text: string;
  /** How many distinct secrets were replaced. */
  count: number;
  /** Labels of what matched, for telling the user without echoing the value. */
  kinds: string[];
}

interface Pattern {
  kind: string;
  regex: RegExp;
  /** Replacement, which may reference capture groups to keep surrounding syntax. */
  replace: string;
}

const PLACEHOLDER = '[REDACTED]';

/**
 * Ordered most specific first: a provider-shaped key should be labelled as
 * such before the generic assignment rule claims it.
 */
const PATTERNS: readonly Pattern[] = [
  {
    kind: 'private-key',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replace: PLACEHOLDER,
  },
  { kind: 'anthropic-key', regex: /sk-ant-[A-Za-z0-9_-]{16,}/g, replace: PLACEHOLDER },
  { kind: 'openai-key', regex: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, replace: PLACEHOLDER },
  {
    kind: 'stripe-key',
    regex: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
    replace: PLACEHOLDER,
  },
  { kind: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/g, replace: PLACEHOLDER },
  { kind: 'github-pat', regex: /github_pat_[A-Za-z0-9_]{20,}/g, replace: PLACEHOLDER },
  { kind: 'npm-token', regex: /npm_[A-Za-z0-9]{30,}/g, replace: PLACEHOLDER },
  { kind: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: PLACEHOLDER },
  { kind: 'google-key', regex: /AIza[0-9A-Za-z_-]{30,}/g, replace: PLACEHOLDER },
  {
    kind: 'aws-access-key',
    regex: /(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: 'jwt',
    regex: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: PLACEHOLDER,
  },
  {
    kind: 'connection-string',
    // `postgres://user:password@host` — the password is the part that matters.
    regex: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi,
    replace: `$1${PLACEHOLDER}$2`,
  },
  {
    kind: 'bearer-token',
    regex: /(bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/gi,
    replace: `$1${PLACEHOLDER}`,
  },
  {
    kind: 'assigned-secret',
    // The catch-all: any identifier that reads like a credential, assigned a
    // string long enough to plausibly be one.
    regex:
      /((?:api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|private[_-]?key|access[_-]?key|auth)\s*[:=]\s*)(['"`])[^'"`\n]{8,}\2/gi,
    replace: `$1$2${PLACEHOLDER}$2`,
  },
  {
    kind: 'env-assignment',
    // `.env` style, which has no quotes: `API_KEY=abc123...`
    regex:
      /^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*\s*=\s*)(?!\s*$)[^\s#]{8,}$/gm,
    replace: `$1${PLACEHOLDER}`,
  },
];

/**
 * Replaces anything that looks like a credential.
 *
 * Returns the kinds that matched so the caller can tell the user what was
 * caught without ever echoing the value itself.
 */
export function redactSecrets(text: string): RedactionResult {
  let output = text;
  const kinds: string[] = [];
  let count = 0;

  for (const pattern of PATTERNS) {
    // A fresh regex per call: the `g` flag carries `lastIndex` between uses.
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    const matches = output.match(regex);
    if (matches === null || matches.length === 0) continue;

    count += matches.length;
    kinds.push(pattern.kind);
    output = output.replace(new RegExp(pattern.regex.source, pattern.regex.flags), pattern.replace);
  }

  return { text: output, count, kinds };
}

/** True when the text contains something that looks like a credential. */
export function containsSecret(text: string): boolean {
  return redactSecrets(text).count > 0;
}

/**
 * Extracts the lines around a violation, redacted.
 *
 * Sending a window rather than the whole file is a privacy decision as much as
 * a token-budget one: a suggestion needs the surrounding lines, not the entire
 * module.
 */
export function extractContext(
  source: string,
  line: number,
  radius = 4,
): { snippet: string; redaction: RedactionResult } {
  const lines = source.split('\n');
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);

  const redaction = redactSecrets(lines.slice(start, end).join('\n'));
  return { snippet: redaction.text, redaction };
}
