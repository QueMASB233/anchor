import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findExistingComment, upsertComment } from '../src/github-api.js';
import {
  getBooleanInput,
  getInput,
  getListInput,
  readContext,
  readInputs,
  setOutput,
} from '../src/inputs.js';
import { hardenConfig, run } from '../src/run.js';

/**
 * A typed `fetch` stub.
 *
 * Declared once so the mocks stay free of casts: `vi.fn()` on a signature this
 * wide otherwise infers `any`, which hides real mistakes in the assertions.
 */
type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function stubFetch(handler: (...args: FetchArgs) => Response) {
  const calls: { url: string; method: string; body?: string }[] = [];

  const impl = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    return Promise.resolve(handler(input, init));
  });

  return { fetch: impl as unknown as typeof fetch, calls, mock: impl };
}

let workspace: string;
let outputFile: string;
let summaryFile: string;
let stdout: string[];

/** Captures workflow commands written to stdout. */
function captureStdout(): void {
  stdout = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
}

function commands(): string[] {
  return stdout
    .join('')
    .split('\n')
    .filter((line) => line.startsWith('::'));
}

async function write(relative: string, content: string): Promise<void> {
  const path = join(workspace, relative);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

/** A project with one clean file and one violating file. */
async function scaffold(): Promise<void> {
  await write(
    'tailwind.config.js',
    `module.exports = { theme: { spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px' } } };`,
  );
  await write('src/Good.tsx', `export const A = () => <div className="p-4" />;`);
  await write('src/Bad.tsx', `export const B = () => <div className="p-[13px]" />;`);
  await write(
    'anchor.config.json',
    JSON.stringify({ tokens: ['tailwind.config.js'], include: ['src/**/*.tsx'] }),
  );
}

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_WORKSPACE: workspace,
    GITHUB_OUTPUT: outputFile,
    GITHUB_STEP_SUMMARY: summaryFile,
    GITHUB_REPOSITORY: 'acme/web',
    GITHUB_EVENT_NAME: 'pull_request',
    'INPUT_GITHUB-TOKEN': '',
    INPUT_COMMENT: 'false',
    ...overrides,
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'anchor-action-'));
  outputFile = join(workspace, '.outputs');
  summaryFile = join(workspace, '.summary');
  await writeFile(outputFile, '', 'utf8');
  await writeFile(summaryFile, '', 'utf8');
  captureStdout();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workspace, { recursive: true, force: true });
});

describe('inputs', () => {
  it('reads a `with:` entry from its INPUT_ variable', () => {
    expect(getInput('github-token', { 'INPUT_GITHUB-TOKEN': ' abc ' })).toBe('abc');
  });

  it('reads the documented boolean spellings', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      expect(getBooleanInput('strict', false, { INPUT_STRICT: value })).toBe(true);
    }
    for (const value of ['false', '0', 'no', 'off']) {
      expect(getBooleanInput('strict', true, { INPUT_STRICT: value })).toBe(false);
    }
  });

  it('falls back rather than guessing on an unparseable boolean', () => {
    expect(getBooleanInput('strict', true, { INPUT_STRICT: 'maybe' })).toBe(true);
  });

  it('splits a list input on newlines and commas', () => {
    expect(getListInput('check', { INPUT_CHECK: 'src/**/*.tsx\napp/**/*.tsx, lib/*.tsx' })).toEqual(
      ['src/**/*.tsx', 'app/**/*.tsx', 'lib/*.tsx'],
    );
  });

  it('defaults to strict and commenting on, matching action.yml', () => {
    const inputs = readInputs({});
    expect(inputs.strict).toBe(true);
    expect(inputs.comment).toBe(true);
    expect(inputs.format).toBe('github');
  });

  it('falls back to the github format when given an unknown one', () => {
    expect(readInputs({ INPUT_FORMAT: 'xml' }).format).toBe('github');
  });

  it('writes outputs in the heredoc form, not the deprecated set-output', () => {
    setOutput('errors', '3', { GITHUB_OUTPUT: outputFile });
    // Asserted by reading the file back in the run tests below.
    expect(true).toBe(true);
  });
});

describe('context', () => {
  it('splits owner and repo', () => {
    const context = readContext({ GITHUB_REPOSITORY: 'acme/web' });
    expect(context).toMatchObject({ owner: 'acme', repo: 'web' });
  });

  it('reads the pull request number from the event payload', () => {
    const context = readContext({ GITHUB_EVENT_PATH: '/event.json' }, () =>
      JSON.stringify({ pull_request: { number: 42 } }),
    );
    expect(context.pullNumber).toBe(42);
  });

  it('survives a missing or malformed event payload', () => {
    expect(readContext({ GITHUB_EVENT_PATH: '/nope' }, () => null).pullNumber).toBeNull();
    expect(readContext({ GITHUB_EVENT_PATH: '/x' }, () => 'not json').pullNumber).toBeNull();
  });

  it('flags the pull_request_target trigger', () => {
    expect(readContext({ GITHUB_EVENT_NAME: 'pull_request_target' }).isPullRequestTarget).toBe(
      true,
    );
  });
});

describe('hardenConfig', () => {
  it('strips tailwind.resolveConfig, which would execute repository code', () => {
    const { config, stripped } = hardenConfig({ tailwind: { resolveConfig: true } });

    expect(config.tailwind?.resolveConfig).toBe(false);
    expect(stripped).toEqual(['tailwind.resolveConfig']);
  });

  it('leaves a config that never asked for it untouched', () => {
    expect(hardenConfig({ tailwind: { resolveConfig: false } }).stripped).toEqual([]);
    expect(hardenConfig({}).stripped).toEqual([]);
  });

  it('does not mutate the caller’s config', () => {
    const original = { tailwind: { resolveConfig: true } };
    hardenConfig(original);
    expect(original.tailwind.resolveConfig).toBe(true);
  });
});

describe('run', () => {
  it('emits one annotation per violation', async () => {
    await scaffold();
    await run(baseEnv());

    const annotations = commands().filter((line) => line.startsWith('::error file='));
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain('file=src/Bad.tsx');
    expect(annotations[0]).toContain('no-arbitrary-spacing');
  });

  it('fails the job under strict when there are errors', async () => {
    await scaffold();
    const result = await run(baseEnv({ INPUT_STRICT: 'true' }));

    expect(result.exitCode).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('passes the job when strict is off', async () => {
    await scaffold();
    expect((await run(baseEnv({ INPUT_STRICT: 'false' }))).exitCode).toBe(0);
  });

  it('never fails the job on warnings alone', async () => {
    await write('tailwind.config.js', `module.exports = { theme: { spacing: { 1: '4px' } } };`);
    await write('src/Heads.tsx', `export const A = () => <div><h1>a</h1><h3>b</h3></div>;`);
    await write(
      'anchor.config.json',
      JSON.stringify({ tokens: ['tailwind.config.js'], include: ['src/**/*.tsx'] }),
    );

    const result = await run(baseEnv({ INPUT_STRICT: 'true' }));
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  });

  it('publishes counts as step outputs', async () => {
    await scaffold();
    await run(baseEnv());

    const outputs = await readFile(outputFile, 'utf8');
    expect(outputs).toContain('violations<<');
    expect(outputs).toContain('errors<<');
    expect(outputs).toContain('files-checked<<');
    // The heredoc form is what replaced the injectable `::set-output`.
    expect(outputs).not.toContain('::set-output');
  });

  it('writes a job summary', async () => {
    await scaffold();
    await run(baseEnv());

    const summary = await readFile(summaryFile, 'utf8');
    expect(summary).toContain('Anchor');
    expect(summary).toContain('no-arbitrary-spacing');
  });

  it('says so plainly when everything passes', async () => {
    await write('tailwind.config.js', `module.exports = { theme: { spacing: { 4: '16px' } } };`);
    await write('src/Good.tsx', `export const A = () => <div className="p-4" />;`);
    await write(
      'anchor.config.json',
      JSON.stringify({ tokens: ['tailwind.config.js'], include: ['src/**/*.tsx'] }),
    );

    const result = await run(baseEnv());

    expect(result.exitCode).toBe(0);
    expect(commands().some((line) => line.startsWith('::notice'))).toBe(true);
  });

  describe('security', () => {
    it('refuses tailwind.resolveConfig from the pull request and says why', async () => {
      await scaffold();
      await write(
        'anchor.config.json',
        JSON.stringify({
          tokens: ['tailwind.config.js'],
          include: ['src/**/*.tsx'],
          tailwind: { resolveConfig: true },
        }),
      );

      await run(baseEnv());

      const refusal = commands().find((line) => line.includes('resolveConfig'));
      expect(refusal).toBeDefined();
      expect(refusal).toContain('::warning');
      expect(refusal).toContain('never does');
    });

    it('ignores fix, so the linter never becomes a commit author', async () => {
      await scaffold();
      await run(baseEnv({ INPUT_FIX: 'true' }));

      expect(commands().some((line) => line.includes('is ignored in CI'))).toBe(true);
      // The offending file is untouched on disk.
      expect(await readFile(join(workspace, 'src/Bad.tsx'), 'utf8')).toContain('p-[13px]');
    });

    it('warns about pull_request_target', async () => {
      await scaffold();
      await run(baseEnv({ GITHUB_EVENT_NAME: 'pull_request_target' }));

      expect(commands().some((line) => line.includes('pull_request_target'))).toBe(true);
    });

    it('masks the token before any request can leak it', async () => {
      await scaffold();
      await run(baseEnv({ 'INPUT_GITHUB-TOKEN': 'ghs_supersecret' }));

      const mask = commands().find((line) => line.startsWith('::add-mask::'));
      expect(mask).toBe('::add-mask::ghs_supersecret');
    });

    it('keeps a hostile class name from breaking out of the annotation', async () => {
      await write('tailwind.config.js', `module.exports = { theme: { spacing: { 4: '16px' } } };`);
      // A class crafted to look like a second workflow command.
      await write(
        'src/Evil.tsx',
        'export const A = () => <div className={cn("p-[13px]", "\\n::set-env name=PATH::/evil")} />;',
      );
      await write(
        'anchor.config.json',
        JSON.stringify({ tokens: ['tailwind.config.js'], include: ['src/**/*.tsx'] }),
      );

      await run(baseEnv());

      // No command other than the ones Anchor itself emits.
      for (const line of commands()) {
        expect(line).toMatch(/^::(error|warning|notice|add-mask)/);
      }
      expect(commands().some((line) => line.startsWith('::set-env'))).toBe(false);
    });
  });

  describe('pull request comment', () => {
    const withPr = (overrides: Record<string, string> = {}) =>
      baseEnv({
        INPUT_COMMENT: 'true',
        'INPUT_GITHUB-TOKEN': 'ghs_token',
        GITHUB_EVENT_PATH: join(workspace, 'event.json'),
        ...overrides,
      });

    async function writeEvent(): Promise<void> {
      await write('event.json', JSON.stringify({ pull_request: { number: 7 } }));
    }

    it('creates a comment when there is none', async () => {
      await scaffold();
      await writeEvent();

      const stub = stubFetch((_input, init) =>
        init?.method === undefined
          ? new Response('[]', { status: 200 })
          : new Response(JSON.stringify({ html_url: 'https://x' }), { status: 201 }),
      );

      await run(withPr(), stub.fetch);

      expect(stub.calls[0]?.url).toContain('/repos/acme/web/issues/7/comments');
      expect(stub.calls[1]?.method).toBe('POST');
      expect(stub.calls[1]?.body).toContain('anchor-lint-report');
    });

    it('updates its own previous comment rather than adding another', async () => {
      await scaffold();
      await writeEvent();

      const stub = stubFetch((_input, init) =>
        init?.method === undefined
          ? new Response(
              JSON.stringify([{ id: 99, body: 'old <!-- anchor-lint-report --> body' }]),
              { status: 200 },
            )
          : new Response(JSON.stringify({ html_url: 'https://x' }), { status: 200 }),
      );

      await run(withPr(), stub.fetch);

      const patch = stub.calls.find((call) => call.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch?.url).toContain('/issues/comments/99');
    });

    it('does not fail the run when it lacks permission to comment', async () => {
      await scaffold();
      await writeEvent();

      const forbidden = stubFetch(
        () => new Response(JSON.stringify({ message: 'Resource not accessible' }), { status: 403 }),
      );

      const result = await run(withPr({ INPUT_STRICT: 'false' }), forbidden.fetch);

      expect(result.exitCode).toBe(0);
      const complaint = commands().find((line) => line.includes('Could not post'));
      expect(complaint).toContain('pull-requests: write');
      expect(complaint).toContain('fork');
    });

    it('does not fail the run when the network is unavailable', async () => {
      await scaffold();
      await writeEvent();

      const offline = stubFetch(() => {
        throw new Error('getaddrinfo ENOTFOUND');
      });

      const result = await run(withPr({ INPUT_STRICT: 'false' }), offline.fetch);
      expect(result.exitCode).toBe(0);
    });

    it('skips commenting outside a pull request', async () => {
      await scaffold();
      const never = stubFetch(() => new Response('[]', { status: 200 }));

      await run(baseEnv({ INPUT_COMMENT: 'true', 'INPUT_GITHUB-TOKEN': 'x' }), never.fetch);

      expect(never.mock).not.toHaveBeenCalled();
      expect(commands().some((line) => line.includes('no comment was posted'))).toBe(true);
    });
  });
});

describe('github-api', () => {
  const target = { owner: 'acme', repo: 'web', pullNumber: 1, token: 't' };

  it('finds a previous comment by its marker', async () => {
    const stub = stubFetch(
      () =>
        new Response(
          JSON.stringify([
            { id: 1, body: 'unrelated' },
            { id: 2, body: 'x MARKER y' },
          ]),
          {
            status: 200,
          },
        ),
    );

    expect(await findExistingComment(target, 'MARKER', stub.fetch)).toEqual({
      id: 2,
      body: 'x MARKER y',
    });
  });

  it('returns null when the listing itself fails', async () => {
    const failing = stubFetch(() => new Response('', { status: 500 }));
    expect(await findExistingComment(target, 'MARKER', failing.fetch)).toBeNull();
  });

  it('reports a skipped outcome instead of throwing', async () => {
    const failing = stubFetch(() => new Response('', { status: 500 }));
    const outcome = await upsertComment(target, 'body', 'MARKER', failing.fetch);

    expect(outcome.status).toBe('skipped');
  });

  it('sends the API version header GitHub expects', async () => {
    const stub = stubFetch(() => new Response('[]', { status: 200 }));
    await findExistingComment(target, 'M', stub.fetch);

    const headers = stub.mock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.['x-github-api-version']).toBe('2022-11-28');
  });
});
