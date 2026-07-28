import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EXIT, type CommandContext } from '../src/commands/context.js';
import { runInit } from '../src/commands/init.js';
import { runLint } from '../src/commands/lint.js';
import { runSync } from '../src/commands/sync.js';
import { validateConfig, ConfigError } from '../src/config.js';
import { Ui } from '../src/ui.js';

/** Captures everything a command prints, so assertions read like the terminal. */
class CapturedUi extends Ui {
  readonly stdoutLines: string[] = [];
  readonly stderrLines: string[] = [];

  constructor() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    // Plain output: colour codes and emoji would make assertions brittle.
    super(
      { color: false, emoji: false, quiet: false },
      (line) => stdout.push(line),
      (line) => stderr.push(line),
    );
    this.stdoutLines = stdout;
    this.stderrLines = stderr;
  }

  // Deliberately not named `stdout`/`stderr`: `Ui.stderr()` is a method, and a
  // getter of the same name would shadow it.
  get stdoutText(): string {
    return this.stdoutLines.join('\n');
  }

  get stderrText(): string {
    return this.stderrLines.join('\n');
  }
}

let cwd: string;
let ui: CapturedUi;

function context(config: CommandContext['config'] = {}): CommandContext {
  return { ui, cwd, version: '1.0.0-test', config, configPath: null };
}

async function write(relative: string, content: string): Promise<void> {
  const path = join(cwd, relative);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function read(relative: string): Promise<string> {
  return readFile(join(cwd, relative), 'utf8');
}

/** A small but realistic Tailwind project. */
async function scaffoldProject(): Promise<void> {
  await write(
    'tailwind.config.js',
    `module.exports = {
      theme: {
        spacing: { 0: '0px', 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px' },
        extend: { colors: { brand: '#3b82f6', surface: '#ffffff' } },
      },
    };`,
  );

  await write(
    'src/components/Button.tsx',
    `import { cva } from 'class-variance-authority';
     export const buttonVariants = cva('rounded p-2', {
       variants: { variant: { primary: 'bg-brand', ghost: 'bg-transparent' } },
     });
     export function Button({ variant }) {
       return <button className="p-2 gap-2">{variant}</button>;
     }`,
  );
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'anchor-e2e-'));
  ui = new CapturedUi();
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('anchor init', () => {
  it('detects Tailwind and writes a usable config', async () => {
    await scaffoldProject();

    const code = await runInit(context());
    expect(code).toBe(EXIT.ok);

    const config = JSON.parse(await read('anchor.config.json')) as {
      tokens: string[];
      components: string[];
      include: string[];
    };

    expect(config.tokens).toContain('tailwind.config.js');
    expect(config.components.length).toBeGreaterThan(0);
    expect(config.include.length).toBeGreaterThan(0);
  });

  it('reports what it actually found, not a generic success', async () => {
    await scaffoldProject();
    await runInit(context());

    expect(ui.stdoutText).toContain('Tailwind CSS');
    expect(ui.stdoutText).toContain('tokens');
    expect(ui.stdoutText).toContain('4px base unit');
  });

  it('mentions the components it discovered from source', async () => {
    await scaffoldProject();
    await runInit(context());
    expect(ui.stdoutText).toMatch(/1 component.? with variants/);
  });

  it('points at the next commands to run', async () => {
    await scaffoldProject();
    await runInit(context());
    expect(ui.stdoutText).toContain('anchor sync');
    expect(ui.stdoutText).toContain('anchor lint');
  });

  it('states the privacy guarantee', async () => {
    await scaffoldProject();
    await runInit(context());
    expect(ui.stdoutText).toContain('Everything ran locally');
  });

  it('refuses to clobber an existing config unless forced', async () => {
    await scaffoldProject();
    await write('anchor.config.json', '{ "name": "mine" }');

    expect(await runInit(context())).toBe(1);
    expect(ui.stdoutText).toContain('already exists');
    expect(await read('anchor.config.json')).toContain('mine');

    expect(await runInit(context(), { force: true })).toBe(EXIT.ok);
    expect(await read('anchor.config.json')).not.toContain('mine');
  });

  it('explains itself when there is no design system to find', async () => {
    await write('README.md', '# Empty');

    expect(await runInit(context())).toBe(1);
    expect(ui.stderrText).toContain('No design system found');
    expect(ui.stderrText).toContain('anchor.config.json');
  });
});

describe('anchor sync', () => {
  const config = { tokens: ['tailwind.config.js'], components: ['src/**/*.tsx'] };

  it('writes all three context files', async () => {
    await scaffoldProject();

    const code = await runSync(context(config));
    expect(code).toBe(EXIT.ok);

    expect(await read('CLAUDE.md')).toContain('Design system');
    expect(await read('.cursorrules')).toContain('HARD RULES');
    expect(await read('AGENTS.md')).toContain('# Design system');
  });

  it('reports created on the first run and unchanged on the second', async () => {
    await scaffoldProject();

    await runSync(context(config));
    expect(ui.stdoutText).toContain('created');

    const second = new CapturedUi();
    ui = second;
    await runSync(context(config));

    expect(second.stdoutText).toContain('unchanged');
    expect(second.stdoutText).toContain('Already in sync');
  });

  it('is byte-identical across runs, so it is safe in a pre-commit hook', async () => {
    await scaffoldProject();

    await runSync(context(config));
    const first = await read('CLAUDE.md');

    await runSync(context(config));
    expect(await read('CLAUDE.md')).toBe(first);
  });

  it('preserves content the team wrote outside the managed block', async () => {
    await scaffoldProject();
    await write('CLAUDE.md', '# My project\n\nRun `pnpm dev` to start.\n');

    await runSync(context(config));

    const content = await read('CLAUDE.md');
    expect(content).toContain('Run `pnpm dev` to start.');
    expect(content).toContain('anchor:start');
  });

  it('--check reports drift without writing', async () => {
    await scaffoldProject();

    const code = await runSync(context(config), { check: true });

    expect(code).toBe(EXIT.violations);
    expect(ui.stdoutText).toContain('would be created');
    await expect(read('CLAUDE.md')).rejects.toThrow();
  });

  it('--check passes once the files are in sync', async () => {
    await scaffoldProject();
    await runSync(context(config));

    expect(await runSync(context(config), { check: true })).toBe(EXIT.ok);
  });

  it('--only limits which files are written', async () => {
    await scaffoldProject();
    await runSync(context(config), { only: ['claude-md'] });

    expect(await read('CLAUDE.md')).toBeTruthy();
    await expect(read('AGENTS.md')).rejects.toThrow();
  });

  it('honours a generator disabled in config', async () => {
    await scaffoldProject();
    await runSync(context({ ...config, generators: { cursorrules: false } }));

    await expect(read('.cursorrules')).rejects.toThrow();
    expect(await read('CLAUDE.md')).toBeTruthy();
  });

  it('writes to a custom path when configured', async () => {
    await scaffoldProject();
    await runSync(context({ ...config, generators: { claudeMd: 'docs/CLAUDE.md' } }));

    expect(await read('docs/CLAUDE.md')).toContain('Design system');
  });
});

describe('anchor lint', () => {
  const config = { tokens: ['tailwind.config.js'], include: ['src/**/*.tsx'] };

  it('passes on code that respects the design system', async () => {
    await scaffoldProject();

    const code = await runLint(context(config));

    expect(code).toBe(EXIT.ok);
    expect(ui.stdoutText).toContain('On system');
  });

  it('reports a violation with file, position and rule', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    await runLint(context(config));

    expect(ui.stdoutText).toContain('src/Bad.tsx');
    expect(ui.stdoutText).toContain('no-arbitrary-spacing');
    expect(ui.stdoutText).toContain('p-3');
  });

  it('exits 0 without --strict, so it can be adopted before it blocks merges', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    expect(await runLint(context(config))).toBe(EXIT.ok);
  });

  it('exits 1 with --strict when there are errors', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    expect(await runLint(context(config), { strict: true })).toBe(EXIT.violations);
  });

  it('does not fail --strict on warnings alone', async () => {
    await scaffoldProject();
    await write('src/Warn.tsx', `export const A = () => <div><h1>a</h1><h3>b</h3></div>;`);

    expect(await runLint(context(config), { strict: true })).toBe(EXIT.ok);
  });

  it('honours --max-warnings', async () => {
    await scaffoldProject();
    await write('src/Warn.tsx', `export const A = () => <div><h1>a</h1><h3>b</h3></div>;`);

    expect(await runLint(context(config), { maxWarnings: 0 })).toBe(EXIT.violations);
    expect(await runLint(context(config), { maxWarnings: 5 })).toBe(EXIT.ok);
  });

  it('applies fixes to disk and re-lints the result', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    const code = await runLint(context(config), { fix: true });

    expect(code).toBe(EXIT.ok);
    expect(await read('src/Bad.tsx')).toContain('p-3');
    expect(await read('src/Bad.tsx')).not.toContain('p-[13px]');
    expect(ui.stdoutText).toContain('Fixed 1 violation');
  });

  it('mentions --fix only when something is actually fixable', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div style={{ margin: '1px' }} />;`);

    await runLint(context(config));
    expect(ui.stdoutText).not.toContain('--fix');
  });

  it('respects a rule turned off in config', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    const code = await runLint(context({ ...config, rules: { 'no-arbitrary-spacing': 'off' } }), {
      strict: true,
    });

    expect(code).toBe(EXIT.ok);
  });

  it('honours a severity override from config', async () => {
    await scaffoldProject();
    await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

    const code = await runLint(
      context({ ...config, rules: { 'no-arbitrary-spacing': 'warning' } }),
      { strict: true },
    );

    expect(code).toBe(EXIT.ok);
  });

  describe('machine-readable output', () => {
    it('emits valid JSON with no banner glued to the front', async () => {
      await scaffoldProject();
      await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

      await runLint(context(config), { format: 'json' });

      // The whole of stdout must parse, or `> report.json` produces garbage.
      const parsed = JSON.parse(ui.stdoutText) as { summary: { errors: number } };
      expect(parsed.summary.errors).toBe(1);
      expect(ui.stdoutText).not.toContain('Anchor');
    });

    it('emits valid SARIF', async () => {
      await scaffoldProject();
      await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

      await runLint(context(config), { format: 'sarif' });

      const parsed = JSON.parse(ui.stdoutText) as { version: string };
      expect(parsed.version).toBe('2.1.0');
    });

    it('emits one workflow command per violation in github format', async () => {
      await scaffoldProject();
      await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

      await runLint(context(config), { format: 'github' });

      const commands = ui.stdoutText.split('\n').filter((line) => line.startsWith('::'));
      expect(commands).toHaveLength(1);
      expect(commands[0]).toContain('file=src/Bad.tsx');
    });

    it('writes the report to a file when asked', async () => {
      await scaffoldProject();
      await runLint(context(config), { format: 'json', outputFile: 'report.json' });

      expect(JSON.parse(await read('report.json'))).toHaveProperty('schemaVersion');
    });

    it('writes a pull request comment body when asked', async () => {
      await scaffoldProject();
      await write('src/Bad.tsx', `export const A = () => <div className="p-[13px]" />;`);

      await runLint(context(config), { commentFile: 'comment.md' });

      const comment = await read('comment.md');
      expect(comment).toContain('anchor-lint-report');
      expect(comment).toContain('no-arbitrary-spacing');
    });
  });

  it('says so clearly when nothing matches the patterns', async () => {
    await scaffoldProject();

    const code = await runLint(context({ ...config, include: ['nothing/**/*.tsx'] }));

    expect(code).toBe(EXIT.ok);
    expect(ui.stdoutText).toContain('No files matched');
  });

  it('skips an unparseable file and reports it rather than failing the run', async () => {
    await scaffoldProject();
    await write('src/Broken.tsx', 'const = = =;');

    const code = await runLint(context(config));

    expect(code).toBe(EXIT.ok);
    expect(ui.stdoutText).toContain('could not be parsed');
  });

  it('caches the parsed design system between runs', async () => {
    await scaffoldProject();

    await runLint(context(config));
    expect(await read('.anchor/cache.json')).toContain('"key"');
    // The cache directory excludes itself from version control.
    expect(await read('.anchor/.gitignore')).toBe('*\n');
  });

  it('rebuilds the cache when the tokens change', async () => {
    await scaffoldProject();
    await runLint(context(config));
    const first = JSON.parse(await read('.anchor/cache.json')) as { key: string };

    await write(
      'tailwind.config.js',
      `module.exports = { theme: { spacing: { 1: '5px', 2: '10px' } } };`,
    );
    await runLint(context(config));

    const second = JSON.parse(await read('.anchor/cache.json')) as { key: string };
    expect(second.key).not.toBe(first.key);
  });
});

describe('error handling', () => {
  it('explains a missing design system rather than throwing', async () => {
    await write('src/App.tsx', '<div />');

    await expect(runLint(context({ tokens: ['does-not-exist.json'] }))).rejects.toThrow(
      /could not find a design system/i,
    );
  });

  it('rejects an unknown rule id instead of silently ignoring it', () => {
    expect(() => validateConfig({ rules: { 'no-such-rule': 'error' } }, null)).toThrow(ConfigError);
    expect(() => validateConfig({ rules: { 'no-such-rule': 'error' } }, null)).toThrow(
      /Unknown rule/,
    );
  });

  it('rejects an unknown top-level config key', () => {
    expect(() => validateConfig({ notAThing: true }, null)).toThrow(ConfigError);
  });

  it('accepts a config that uses every documented field', () => {
    expect(() =>
      validateConfig(
        {
          name: 'Acme',
          tokens: ['tokens.json'],
          components: ['src/**/*.tsx'],
          include: ['src/**/*.tsx'],
          exclude: ['**/*.stories.tsx'],
          rules: { 'no-inline-styles': { severity: 'warning', options: { allowDynamic: false } } },
          classHelpers: ['myCn'],
          rootFontSize: 16,
          generators: { claudeMd: true, cursorrules: false, agentsMd: 'docs/AGENTS.md' },
          tailwind: { resolveConfig: false },
          cacheDir: '.cache/anchor',
        },
        null,
      ),
    ).not.toThrow();
  });
});
