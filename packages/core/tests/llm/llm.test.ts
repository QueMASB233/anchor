import { describe, expect, it, vi } from 'vitest';

import type { Violation } from '../../src/engine/violation.js';
import { getAdapter, ADAPTERS } from '../../src/llm/adapters/index.js';
import { containsSecret, extractContext, redactSecrets } from '../../src/llm/redact.js';
import { resolveLlm, suggestFixes } from '../../src/llm/suggest.js';
import type { LlmConfig, SuggestInput } from '../../src/llm/types.js';

/**
 * Credential-shaped test values, assembled at runtime.
 *
 * These are fake, but they are *shaped* like the real thing — which is the
 * whole point of the fixture and also why a literal would trip GitHub's push
 * protection and every other scanner pointed at this repository. Joining the
 * parts keeps the runtime value identical while leaving no scannable literal
 * in the file. The alternative, allow-listing a "secret" in the repo of a
 * security tool, is not one.
 */
const FAKE = {
  anthropic: ['sk', 'ant', 'api03', 'AbCdEf1234567890XyZaBcDeFg'].join('-'),
  openai: ['sk', 'proj', 'AbCdEf1234567890XyZaBcDeFgHi'].join('-'),
  stripe: ['sk', 'live', 'AbCdEf1234567890XyZa'].join('_'),
  github: ['ghp', 'AbCdEf1234567890XyZaBcDeFgHiJkLmNo'].join('_'),
  githubPat: ['github', 'pat', '11ABCDEFG0abcdefghijkl_ABCDEFGHIJ'].join('_'),
  npm: ['npm', 'AbCdEf1234567890XyZaBcDeFgHiJkLmNoPq'].join('_'),
  slack: ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
  google: ['AIza', 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q'].join(''),
  aws: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  jwt: [
    ['eyJhbGciOiJIUzI1NiJ9'],
    ['eyJzdWIiOiIxMjM0NTY3ODkwIn0'],
    ['dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ]
    .flat()
    .join('.'),
} as const;

function violation(overrides: Partial<Violation> = {}): Violation {
  return {
    ruleId: 'no-arbitrary-spacing',
    severity: 'error',
    file: 'src/Button.tsx',
    line: 3,
    column: 17,
    endLine: 3,
    endColumn: 25,
    message: '`p-[13px]` uses an arbitrary spacing value. Use `p-3` (12px) instead.',
    suggestedFix: 'p-3',
    ...overrides,
  };
}

const SOURCE = [
  'import { cn } from "@/lib/utils";',
  '',
  'export const A = () => <div className="p-[13px]" />;',
  '',
  'export default A;',
].join('\n');

function input(overrides: Partial<Violation> = {}): SuggestInput {
  return { violation: violation(overrides), source: SOURCE };
}

/** A fetch stub that records what was actually transmitted. */
function stubFetch(reply: () => Response) {
  const bodies: string[] = [];
  const impl = vi.fn((_input: string, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === 'string') bodies.push(init.body);
    return Promise.resolve(reply());
  });
  return { fetch: impl as unknown as typeof fetch, bodies, mock: impl };
}

function textReply(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
}

describe('redactSecrets', () => {
  describe('provider-shaped credentials', () => {
    it.each([
      ['anthropic', FAKE.anthropic],
      ['openai', FAKE.openai],
      ['stripe', FAKE.stripe],
      ['github', FAKE.github],
      ['github pat', FAKE.githubPat],
      ['npm', FAKE.npm],
      ['slack', FAKE.slack],
      ['google', FAKE.google],
      ['aws', FAKE.aws],
    ])('removes a %s key', (_label, secret) => {
      const result = redactSecrets(`const key = "${secret}";`);

      expect(result.text).not.toContain(secret);
      expect(result.text).toContain('[REDACTED]');
      expect(result.count).toBeGreaterThan(0);
    });
  });

  it('removes a JWT', () => {
    expect(redactSecrets(FAKE.jwt).text).not.toContain('dozjgNryP4J3');
  });

  it('removes a private key block entirely', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAxGZk',
      'SECRETMATERIALHERE',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');

    const result = redactSecrets(`const pem = \`${key}\`;`);
    expect(result.text).not.toContain('SECRETMATERIALHERE');
    expect(result.kinds).toContain('private-key');
  });

  it('removes the password from a connection string, keeping the shape', () => {
    const result = redactSecrets('postgres://admin:hunter2isbad@db.internal:5432/app');

    expect(result.text).not.toContain('hunter2isbad');
    // The rest survives, so the snippet still reads as a connection string.
    expect(result.text).toContain('postgres://admin:');
    expect(result.text).toContain('@db.internal:5432/app');
  });

  it('removes a bearer token but keeps the header shape', () => {
    const result = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');

    expect(result.text).not.toContain('abcdefghijklmnop');
    expect(result.text).toContain('Bearer [REDACTED]');
  });

  it('catches a credential-shaped assignment it has no specific pattern for', () => {
    const result = redactSecrets(`const config = { apiKey: "zzzz-internal-format-9999" };`);

    expect(result.text).not.toContain('zzzz-internal-format-9999');
    expect(result.kinds).toContain('assigned-secret');
  });

  it('catches a .env style assignment', () => {
    const result = redactSecrets('DATABASE_PASSWORD=sup3rs3cr3tvalue');
    expect(result.text).not.toContain('sup3rs3cr3tvalue');
  });

  it('removes several distinct secrets in one pass', () => {
    const result = redactSecrets(
      [`const a = "${FAKE.github}";`, `const b = "${FAKE.aws}";`].join('\n'),
    );
    expect(result.count).toBe(2);
    expect(result.text).not.toMatch(/ghp_|AKIA/);
  });

  describe('what it must leave alone', () => {
    it('does not touch ordinary component code', () => {
      expect(redactSecrets(SOURCE)).toMatchObject({ text: SOURCE, count: 0 });
    });

    it('does not redact a short value that merely sits next to the word token', () => {
      // `token: 'p-4'` is a design token name, not a credential.
      expect(redactSecrets(`const x = { token: 'p-4' };`).count).toBe(0);
    });

    it('does not mangle class names that resemble base64', () => {
      const classes = '<div className="bg-brand text-secondary rounded-md" />';
      expect(redactSecrets(classes).text).toBe(classes);
    });
  });

  it('reports what kind matched without echoing the value', () => {
    const result = redactSecrets(`const k = "${FAKE.anthropic}";`);
    expect(result.kinds).toContain('anthropic-key');
    expect(result.kinds.join(' ')).not.toContain('AbCdEf');
  });

  it('is idempotent', () => {
    const once = redactSecrets(`const k = "${FAKE.github}";`).text;
    expect(redactSecrets(once).text).toBe(once);
  });
});

describe('containsSecret', () => {
  it('answers yes and no correctly', () => {
    expect(containsSecret(`const k = "${FAKE.aws}";`)).toBe(true);
    expect(containsSecret('const k = "p-4";')).toBe(false);
  });
});

describe('extractContext', () => {
  it('sends a window around the line, not the whole file', () => {
    const long = Array.from({ length: 200 }, (_unused, index) => `line ${index}`).join('\n');
    const { snippet } = extractContext(long, 100, 2);

    expect(snippet.split('\n')).toHaveLength(5);
    expect(snippet).toContain('line 99');
  });

  it('clamps at the start and end of a file', () => {
    expect(() => extractContext('a\nb', 1, 10)).not.toThrow();
    expect(extractContext('a\nb', 1, 10).snippet).toBe('a\nb');
  });

  it('redacts within the window', () => {
    const source = ['const a = 1;', `const k = "${FAKE.aws}";`, 'const b = 2;'].join('\n');
    const { snippet, redaction } = extractContext(source, 2, 1);

    expect(snippet).not.toContain(FAKE.aws);
    expect(redaction.count).toBe(1);
  });
});

describe('resolveLlm — the consent gate', () => {
  it('is off when there is no config at all', () => {
    const result = resolveLlm(undefined, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.inactive).toBe(true);
      expect(result.reason).toContain('lints exactly the same');
    }
  });

  it('is off when enabled is absent, even with a key in the environment', () => {
    // The critical case: a key exported for another tool must not switch this on.
    const result = resolveLlm({ provider: 'openai' }, { OPENAI_API_KEY: 'sk-real-key' });
    expect(result.ok).toBe(false);
  });

  it('is off when enabled is false', () => {
    expect(resolveLlm({ enabled: false, provider: 'ollama' }, {}).ok).toBe(false);
  });

  it.each([[1], ['true'], [{}], [null]])('requires exactly true, not %s', (value) => {
    const config = { enabled: value, provider: 'ollama' } as unknown as LlmConfig;
    expect(resolveLlm(config, {}).ok).toBe(false);
  });

  it('turns on for Ollama with no key at all', () => {
    const result = resolveLlm({ enabled: true, provider: 'ollama' }, {});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.llm.adapter.isLocal).toBe(true);
      expect(result.llm.apiKey).toBeNull();
    }
  });

  it('defaults to Ollama, the provider that transmits nothing', () => {
    const result = resolveLlm({ enabled: true }, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.llm.adapter.provider).toBe('ollama');
  });

  it('reads the key from the provider’s environment variable', () => {
    const result = resolveLlm(
      { enabled: true, provider: 'anthropic' },
      { ANTHROPIC_API_KEY: 'sk-ant-xyz' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.llm.apiKey).toBe('sk-ant-xyz');
  });

  it('prefers an explicit config key over the environment', () => {
    const result = resolveLlm(
      { enabled: true, provider: 'anthropic', apiKey: 'from-config' },
      { ANTHROPIC_API_KEY: 'from-env' },
    );
    if (result.ok) expect(result.llm.apiKey).toBe('from-config');
  });

  it('refuses a remote provider with no key, and points at the local option', () => {
    const result = resolveLlm({ enabled: true, provider: 'openai' }, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.inactive).toBe(false);
      expect(result.reason).toContain('OPENAI_API_KEY');
      expect(result.reason).toContain('ollama');
    }
  });

  it('rejects an unknown provider', () => {
    const config = { enabled: true, provider: 'skynet' } as unknown as LlmConfig;
    expect(resolveLlm(config, {}).ok).toBe(false);
  });

  it('applies documented defaults', () => {
    const result = resolveLlm({ enabled: true, provider: 'ollama' }, {});
    if (result.ok) {
      expect(result.llm.model).toBe('llama3.1');
      expect(result.llm.timeoutMs).toBe(20_000);
      expect(result.llm.maxSuggestions).toBe(10);
    }
  });
});

describe('suggestFixes', () => {
  it('sends nothing at all when the layer is off', async () => {
    const stub = stubFetch(() => textReply('never'));
    const outcome = await suggestFixes([input()], undefined, { fetchImpl: stub.fetch });

    expect(stub.mock).not.toHaveBeenCalled();
    expect(outcome.suggestions).toEqual([]);
    expect(outcome.skipped).toContain('LLM layer is off');
  });

  it('sends nothing when enabled but unusable', async () => {
    const stub = stubFetch(() => textReply('never'));
    await suggestFixes([input()], { enabled: true, provider: 'openai' }, { fetchImpl: stub.fetch });

    expect(stub.mock).not.toHaveBeenCalled();
  });

  it('returns a suggestion when properly configured', async () => {
    const stub = stubFetch(() => textReply('Add a `dense` variant to Button instead.'));

    const outcome = await suggestFixes(
      [input()],
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, fetchImpl: stub.fetch },
    );

    expect(outcome.suggestions).toHaveLength(1);
    expect(outcome.suggestions[0]).toMatchObject({
      ruleId: 'no-arbitrary-spacing',
      text: 'Add a `dense` variant to Button instead.',
      provider: 'anthropic',
    });
  });

  it('redacts secrets before they reach the wire', async () => {
    const stub = stubFetch(() => textReply('ok'));
    const leaky = [
      'const a = 1;',
      `const KEY = "${FAKE.anthropic}";`,
      'export const A = () => <div className="p-[13px]" />;',
    ].join('\n');

    const outcome = await suggestFixes(
      [{ violation: violation({ line: 3 }), source: leaky }],
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'sk-ant-test' }, fetchImpl: stub.fetch },
    );

    const sent = stub.bodies.join('');
    expect(sent).not.toContain(FAKE.anthropic);
    expect(sent).toContain('[REDACTED]');
    expect(outcome.redactedSecrets).toBe(1);
  });

  it('never puts the API key into the prompt body', async () => {
    const stub = stubFetch(() => textReply('ok'));
    await suggestFixes(
      [input()],
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'sk-ant-supersecret' }, fetchImpl: stub.fetch },
    );

    expect(stub.bodies.join('')).not.toContain('sk-ant-supersecret');
  });

  it('sends only a window of the file, not all of it', async () => {
    const stub = stubFetch(() => textReply('ok'));
    const long = [
      ...Array.from({ length: 60 }, (_u, i) => `const far${i} = ${i};`),
      'export const A = () => <div className="p-[13px]" />;',
      ...Array.from({ length: 60 }, (_u, i) => `const after${i} = ${i};`),
    ].join('\n');

    await suggestFixes(
      [{ violation: violation({ line: 61 }), source: long }],
      { enabled: true, provider: 'anthropic', contextLines: 2 },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: stub.fetch },
    );

    const sent = stub.bodies.join('');
    expect(sent).toContain('p-[13px]');
    expect(sent).not.toContain('far0');
    expect(sent).not.toContain('after59');
  });

  it('survives a provider error without losing the lint result', async () => {
    const failing = stubFetch(() => new Response('rate limited', { status: 429 }));

    const outcome = await suggestFixes(
      [input()],
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: failing.fetch },
    );

    expect(outcome.suggestions).toEqual([]);
    expect(outcome.warnings[0]).toContain('429');
    expect(outcome.warnings[0]).toContain('rate limiting');
  });

  it('never leaks the key through an error message', async () => {
    const failing = stubFetch(() => new Response('unauthorized', { status: 401 }));

    const outcome = await suggestFixes(
      [input()],
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'sk-ant-supersecret' }, fetchImpl: failing.fetch },
    );

    expect(outcome.warnings.join(' ')).not.toContain('sk-ant-supersecret');
    expect(outcome.warnings.join(' ')).toContain('Check that the API key is valid');
  });

  it('gives up on a slow provider rather than hanging the run', async () => {
    const never = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    ) as unknown as typeof fetch;

    const outcome = await suggestFixes(
      [input()],
      { enabled: true, provider: 'anthropic', timeoutMs: 20 },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: never },
    );

    expect(outcome.suggestions).toEqual([]);
    expect(outcome.warnings[0]).toContain('timed out');
  });

  it('caps how many violations are sent', async () => {
    const stub = stubFetch(() => textReply('ok'));
    const many = Array.from({ length: 25 }, (_u, index) => input({ line: index + 1 }));

    const outcome = await suggestFixes(
      many,
      { enabled: true, provider: 'anthropic', maxSuggestions: 3 },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: stub.fetch },
    );

    expect(stub.bodies).toHaveLength(3);
    expect(outcome.skipped).toContain('first 3 violations');
  });

  it('spends the budget on errors before warnings', async () => {
    const stub = stubFetch(() => textReply('ok'));

    await suggestFixes(
      [
        input({ severity: 'warning', ruleId: 'use-design-tokens', line: 1 }),
        input({ severity: 'error', ruleId: 'no-inline-styles', line: 2 }),
      ],
      { enabled: true, provider: 'anthropic', maxSuggestions: 1 },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: stub.fetch },
    );

    expect(stub.bodies[0]).toContain('no-inline-styles');
  });

  it('returns results in source order despite concurrency', async () => {
    const stub = stubFetch(() => textReply('ok'));
    const inputs = [5, 1, 3].map((line) => input({ line }));

    const outcome = await suggestFixes(
      inputs,
      { enabled: true, provider: 'anthropic' },
      { env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: stub.fetch },
    );

    expect(outcome.suggestions.map((entry) => entry.line)).toEqual([1, 3, 5]);
  });

  it('does nothing when there are no violations', async () => {
    const stub = stubFetch(() => textReply('ok'));
    const outcome = await suggestFixes(
      [],
      { enabled: true, provider: 'ollama' },
      {
        fetchImpl: stub.fetch,
      },
    );

    expect(stub.mock).not.toHaveBeenCalled();
    expect(outcome.suggestions).toEqual([]);
  });
});

describe('adapters', () => {
  it('exposes all four providers', () => {
    expect(ADAPTERS.map((adapter) => adapter.provider).sort()).toEqual([
      'anthropic',
      'deepseek',
      'ollama',
      'openai',
    ]);
  });

  it('marks only Ollama as local', () => {
    expect(getAdapter('ollama').isLocal).toBe(true);
    for (const provider of ['anthropic', 'openai', 'deepseek'] as const) {
      expect(getAdapter(provider).isLocal).toBe(false);
    }
  });

  it('needs no key variable for Ollama', () => {
    expect(getAdapter('ollama').apiKeyEnvVar).toBeNull();
  });

  it('sends the Anthropic key as a header, never in the body', async () => {
    const stub = stubFetch(() => textReply('ok'));
    await getAdapter('anthropic').complete(
      {
        system: 's',
        prompt: 'p',
        model: 'claude-sonnet-5',
        apiKey: 'sk-ant-secret',
        baseUrl: undefined,
        signal: new AbortController().signal,
      },
      stub.fetch,
    );

    const init = stub.mock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    const body = typeof init?.body === 'string' ? init.body : '';

    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(body).not.toContain('sk-ant-secret');
  });

  it('sends a bearer token for OpenAI-compatible providers', async () => {
    const stub = stubFetch(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200,
        }),
    );

    await getAdapter('deepseek').complete(
      {
        system: 's',
        prompt: 'p',
        model: 'deepseek-chat',
        apiKey: 'dk-secret',
        baseUrl: undefined,
        signal: new AbortController().signal,
      },
      stub.fetch,
    );

    const headers = stub.mock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer dk-secret');
    expect(stub.mock.mock.calls[0]?.[0]).toContain('api.deepseek.com');
  });

  it('explains how to start Ollama when it is not running', async () => {
    const offline = vi.fn(() =>
      Promise.reject(new Error('ECONNREFUSED')),
    ) as unknown as typeof fetch;

    await expect(
      getAdapter('ollama').complete(
        {
          system: 's',
          prompt: 'p',
          model: 'llama3.1',
          apiKey: null,
          baseUrl: undefined,
          signal: new AbortController().signal,
        },
        offline,
      ),
    ).rejects.toThrow(/ollama serve/);
  });

  it('honours a custom base URL, for a self-hosted or proxied endpoint', async () => {
    const stub = stubFetch(
      () => new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 }),
    );

    await getAdapter('ollama').complete(
      {
        system: 's',
        prompt: 'p',
        model: 'llama3.1',
        apiKey: null,
        baseUrl: 'http://gpu-box.internal:11434',
        signal: new AbortController().signal,
      },
      stub.fetch,
    );

    expect(stub.mock.mock.calls[0]?.[0]).toBe('http://gpu-box.internal:11434/api/chat');
  });
});
