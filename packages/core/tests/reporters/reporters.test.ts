import { describe, expect, it } from 'vitest';

import type { LintFileResult } from '../../src/engine/linter.js';
import type { Violation } from '../../src/engine/violation.js';
import {
  annotationFor,
  buildReport,
  COMMENT_MARKER,
  escapeData,
  escapeMarkdownCell,
  escapeProperty,
  getReporter,
  jsonReporter,
  renderComment,
  REPORTER_FORMATS,
  sarifReporter,
  shouldUseColor,
  terminalReporter,
} from '../../src/reporters/index.js';

/**
 * Overrides that may explicitly clear an optional field. `exactOptionalPropertyTypes`
 * rejects `fix: undefined` against `Partial<Violation>`, so the key is removed
 * rather than set to undefined.
 */
type ViolationOverrides = { [K in keyof Violation]?: Violation[K] | undefined };

function violation(overrides: ViolationOverrides = {}): Violation {
  const merged: Record<string, unknown> = {
    ruleId: 'no-arbitrary-spacing',
    severity: 'error',
    file: '/repo/src/Button.tsx',
    line: 3,
    column: 17,
    endLine: 3,
    endColumn: 25,
    message: '`p-[13px]` uses an arbitrary spacing value. Use `p-3` (12px) instead.',
    suggestedFix: 'p-3',
    fix: { range: [40, 48], text: 'p-3' },
    ...overrides,
  };

  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }

  return merged as unknown as Violation;
}

function report(results: LintFileResult[] = []) {
  return buildReport({
    results,
    designSystem: { name: 'Acme', source: 'tailwind' },
    durationMs: 120,
  });
}

const populated = report([
  { file: '/repo/src/Button.tsx', violations: [violation()] },
  {
    file: '/repo/src/Card.tsx',
    violations: [
      violation({
        file: '/repo/src/Card.tsx',
        ruleId: 'use-design-tokens',
        severity: 'warning',
        line: 8,
        column: 5,
        endColumn: 19,
        message: '`text-gray-500` uses the palette value directly.',
        fix: undefined,
      }),
    ],
  },
  { file: '/repo/src/Clean.tsx', violations: [] },
]);

describe('buildReport', () => {
  it('aggregates counts across files', () => {
    expect(populated.counts).toEqual({ errors: 1, warnings: 1, total: 2, fixable: 1 });
    expect(populated.filesChecked).toBe(3);
    expect(populated.filesWithViolations).toBe(2);
  });

  it('orders violations by file, then position', () => {
    expect(populated.violations.map((entry) => entry.file)).toEqual([
      '/repo/src/Button.tsx',
      '/repo/src/Card.tsx',
    ]);
  });

  it('handles an empty run', () => {
    expect(report().counts.total).toBe(0);
  });
});

describe('shouldUseColor', () => {
  it('honours NO_COLOR above everything else', () => {
    expect(shouldUseColor({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
  });

  it('honours FORCE_COLOR when NO_COLOR is unset', () => {
    expect(shouldUseColor({ FORCE_COLOR: '1' }, false)).toBe(true);
  });

  it('stays plain in CI, where colour becomes log noise', () => {
    expect(shouldUseColor({ CI: 'true' }, true)).toBe(false);
  });

  it('follows the terminal otherwise', () => {
    expect(shouldUseColor({}, true)).toBe(true);
    expect(shouldUseColor({}, false)).toBe(false);
  });
});

describe('terminal reporter', () => {
  it('reports position, severity, message and rule', () => {
    const output = terminalReporter.render(populated, { cwd: '/repo' });
    expect(output).toContain('src/Button.tsx');
    expect(output).toContain('3:17');
    expect(output).toContain('error');
    expect(output).toContain('no-arbitrary-spacing');
  });

  it('shortens paths against the working directory', () => {
    expect(terminalReporter.render(populated, { cwd: '/repo' })).not.toContain('/repo/src');
  });

  it('summarizes errors and warnings separately', () => {
    const output = terminalReporter.render(populated);
    expect(output).toContain('2 violations (1 error, 1 warning)');
    expect(output).toContain('in 2 files');
  });

  it('points at --fix only when something is fixable', () => {
    expect(terminalReporter.render(populated)).toContain('anchor lint --fix');

    const unfixable = report([
      { file: 'a.tsx', violations: [violation({ file: 'a.tsx', fix: undefined })] },
    ]);
    expect(terminalReporter.render(unfixable)).not.toContain('--fix');
  });

  it('says so plainly when there is nothing to report', () => {
    const clean = report([{ file: 'a.tsx', violations: [] }]);
    expect(terminalReporter.render(clean)).toContain('No design system violations in 1 file.');
  });

  it('emits no ANSI codes unless colour is requested', () => {
    // eslint-disable-next-line no-control-regex -- asserting the absence of ANSI
    const ansi = /\[/;
    expect(ansi.test(terminalReporter.render(populated))).toBe(false);
    expect(ansi.test(terminalReporter.render(populated, { color: true }))).toBe(true);
  });

  it('draws a code frame under the offending text when source is available', () => {
    const source = ['import x from "y";', '', 'const a = <div className="p-[13px]" />;'].join('\n');
    const output = terminalReporter.render(populated, {
      getSource: (path) => (path.endsWith('Button.tsx') ? source : undefined),
    });

    expect(output).toContain('const a = <div className="p-[13px]" />;');
    expect(output).toContain('^^^^^^^^');
  });

  it('reports a parse error rather than pretending the file was clean', () => {
    const broken = report([
      { file: 'Bad.tsx', violations: [], parseError: { message: 'Unexpected token' } },
    ]);
    const output = terminalReporter.render(broken);
    expect(output).toContain('parse error');
    expect(output).toContain('Unexpected token');
  });
});

describe('json reporter', () => {
  const parsed = JSON.parse(jsonReporter.render(populated, { version: '1.2.3' })) as {
    schemaVersion: number;
    anchorVersion: string;
    summary: Record<string, number>;
    files: { path: string; violations: { fixable: boolean; ruleId: string }[] }[];
  };

  it('is valid JSON with a declared schema version', () => {
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.anchorVersion).toBe('1.2.3');
  });

  it('carries the summary counts', () => {
    expect(parsed.summary).toMatchObject({ errors: 1, warnings: 1, total: 2, fixable: 1 });
  });

  it('reports fixability as a boolean rather than exporting byte offsets', () => {
    // Offsets are meaningless outside the exact revision Anchor read.
    const rendered = jsonReporter.render(populated);
    expect(parsed.files[0]?.violations[0]?.fixable).toBe(true);
    expect(rendered).not.toContain('"range"');
  });

  it('includes files that were clean, so consumers can see coverage', () => {
    expect(parsed.files.map((file) => file.path)).toContain('/repo/src/Clean.tsx');
  });
});

describe('sarif reporter', () => {
  const sarif = JSON.parse(sarifReporter.render(populated, { cwd: '/repo', version: '1.0.0' })) as {
    version: string;
    $schema: string;
    runs: {
      tool: { driver: { name: string; version: string; rules: { id: string }[] } };
      results: {
        ruleId: string;
        ruleIndex: number;
        level: string;
        locations: {
          physicalLocation: {
            artifactLocation: { uri: string };
            region: { startLine: number; startColumn: number };
          };
        }[];
        partialFingerprints: Record<string, string>;
      }[];
    }[];
  };

  it('declares SARIF 2.1.0 and its schema', () => {
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-2.1.0');
  });

  it('declares every rule so the Security tab can describe them', () => {
    const ids = sarif.runs[0]?.tool.driver.rules.map((rule) => rule.id) ?? [];
    expect(ids).toContain('no-arbitrary-spacing');
    expect(ids).toContain('heading-order');
  });

  it('links each result to its rule by index', () => {
    const result = sarif.runs[0]?.results[0];
    const rules = sarif.runs[0]?.tool.driver.rules ?? [];
    expect(rules[result!.ruleIndex]?.id).toBe(result?.ruleId);
  });

  it('maps severities onto SARIF levels', () => {
    expect(sarif.runs[0]?.results.map((result) => result.level)).toEqual(['error', 'warning']);
  });

  it('emits repository-relative URIs', () => {
    const uri = sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri;
    expect(uri).toBe('src/Button.tsx');
  });

  it('records the exact region', () => {
    const region = sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation.region;
    expect(region).toMatchObject({ startLine: 3, startColumn: 17 });
  });

  it('fingerprints without the line number, so edits above do not re-open findings', () => {
    const moved = report([
      { file: '/repo/src/Button.tsx', violations: [violation({ line: 40, endLine: 40 })] },
    ]);
    const movedSarif = JSON.parse(sarifReporter.render(moved, { cwd: '/repo' })) as typeof sarif;

    expect(movedSarif.runs[0]?.results[0]?.partialFingerprints).toEqual(
      sarif.runs[0]?.results[0]?.partialFingerprints,
    );
  });

  it('gives different violations different fingerprints', () => {
    const first = sarif.runs[0]?.results[0]?.partialFingerprints['anchorViolation'];
    const second = sarif.runs[0]?.results[1]?.partialFingerprints['anchorViolation'];
    expect(first).not.toBe(second);
  });
});

describe('github workflow command escaping', () => {
  // These are security tests. Violation messages quote content from the file
  // being linted, which in CI comes from a pull request written by anyone.

  it('escapes the characters that terminate a command payload', () => {
    expect(escapeData('100% done\nnext')).toBe('100%25 done%0Anext');
    expect(escapeData('a\r\nb')).toBe('a%0D%0Ab');
  });

  it('escapes percent first, so later escapes are not double-encoded', () => {
    expect(escapeData('%0A')).toBe('%250A');
  });

  it('escapes the structural characters inside property values', () => {
    expect(escapeProperty('a:b,c')).toBe('a%3Ab%2Cc');
  });

  it('neutralizes an attempt to inject a second workflow command', () => {
    const hostile = violation({
      message: 'x\n::set-env name=PATH::/tmp/evil\n::error::pwned',
    });
    const line = annotationFor(hostile);

    // The runner parses commands line by line, so the property that actually
    // protects us is that the annotation stays on a single line. `::set-env`
    // surviving mid-line is inert text, not a command.
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('%0A::set-env');
    expect(/^::(?!error )/m.test(line)).toBe(false);
  });

  it('neutralizes an injection through a crafted file path', () => {
    const hostile = violation({ file: 'src/a,line=99,col=1::error::pwned.tsx' });
    const line = annotationFor(hostile);

    // Commas and colons are what delimit properties and terminate the header,
    // so both must be encoded. `=` is safe unescaped: the runner splits each
    // property on its first `=` only, matching GitHub's own escaping rules.
    expect(line).toContain('%2Cline=99');
    expect(line).toContain('%3A%3Aerror');
    // Only the command opener and the payload separator remain structural.
    expect(line.match(/::/g) ?? []).toHaveLength(2);
  });

  it('still produces a well-formed annotation for ordinary input', () => {
    expect(annotationFor(violation(), '/repo')).toBe(
      '::error file=src/Button.tsx,line=3,col=17,endLine=3,endColumn=25,title=Anchor%3A no-arbitrary-spacing::' +
        '`p-[13px]` uses an arbitrary spacing value. Use `p-3` (12px) instead.',
    );
  });

  it('uses ::warning for warnings', () => {
    expect(annotationFor(violation({ severity: 'warning' })).startsWith('::warning ')).toBe(true);
  });
});

describe('github pull request comment', () => {
  it('carries a marker so the Action can update its own comment', () => {
    expect(renderComment(populated)).toContain(COMMENT_MARKER);
  });

  it('summarizes errors and warnings', () => {
    const body = renderComment(populated, { cwd: '/repo' });
    expect(body).toContain('**1** error and **1** warning');
    expect(body).toContain('across 2 files');
  });

  it('groups violations under their file', () => {
    const body = renderComment(populated, { cwd: '/repo' });
    expect(body).toContain('#### `src/Button.tsx`');
    expect(body).toContain('| 3:17 |');
  });

  it('mentions the fix command only when something is fixable', () => {
    expect(renderComment(populated)).toContain('anchor lint --fix');
  });

  it('states the privacy guarantee, which is the product’s pitch', () => {
    expect(renderComment(populated)).toContain('No code left this runner');
  });

  it('reports success plainly when there is nothing to say', () => {
    const clean = report([{ file: 'a.tsx', violations: [] }]);
    expect(renderComment(clean)).toContain('design system check passed');
  });

  it('keeps a crafted class name from breaking the table', () => {
    const hostile = violation({
      message: 'Bad class `a|b` found\nrow two | injected | cells',
    });
    const body = renderComment(report([{ file: 'a.tsx', violations: [hostile] }]));

    const tableRows = body.split('\n').filter((line) => line.startsWith('| '));
    // Header, separator, and exactly one data row.
    expect(tableRows).toHaveLength(3);
    expect(body).toContain('\\|');
  });

  it('neutralizes raw HTML from linted content', () => {
    const hostile = violation({ message: 'found <img src=x onerror=alert(1)>' });
    const body = renderComment(report([{ file: 'a.tsx', violations: [hostile] }]));
    expect(body).toContain('&lt;img');
    expect(body).not.toContain('<img');
  });

  it('truncates rather than exceeding GitHub’s comment limit', () => {
    const many = Array.from({ length: 4000 }, (_unused, index) =>
      violation({ file: `src/File${index}.tsx`, line: index + 1 }),
    );
    const huge = report(many.map((entry) => ({ file: entry.file, violations: [entry] })));
    const body = renderComment(huge);

    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toContain('Report truncated');
  });

  it('summarizes the tail when one file has very many violations', () => {
    const many = Array.from({ length: 30 }, (_unused, index) =>
      violation({ file: 'a.tsx', line: index + 1 }),
    );
    const body = renderComment(report([{ file: 'a.tsx', violations: many }]));
    expect(body).toContain('… and 10 more in this file.');
  });
});

describe('escapeMarkdownCell', () => {
  it('collapses newlines that would end a table early', () => {
    expect(escapeMarkdownCell('a\nb')).toBe('a b');
  });

  it('escapes pipes that would create extra columns', () => {
    expect(escapeMarkdownCell('a|b')).toBe('a\\|b');
  });
});

describe('getReporter', () => {
  it('resolves every advertised format', () => {
    for (const format of REPORTER_FORMATS) {
      expect(getReporter(format).format).toBe(format);
    }
  });

  it('advertises exactly the four formats the CLI documents', () => {
    expect([...REPORTER_FORMATS].sort()).toEqual(['github', 'json', 'sarif', 'terminal']);
  });

  it('names the alternatives when asked for an unknown format', () => {
    // @ts-expect-error deliberately invalid
    expect(() => getReporter('xml')).toThrow(/Available: terminal, json, sarif, github/);
  });
});
