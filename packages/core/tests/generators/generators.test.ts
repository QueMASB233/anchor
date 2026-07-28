import { describe, expect, it } from 'vitest';

import {
  createColorSystem,
  createDesignSystem,
  createNamedTokens,
  createScaleTokens,
  createShadowSystem,
  createSpacingScale,
  createTypographySystem,
  type DesignSystem,
} from '../../src/model/index.js';
import { parseTailwindV3 } from '../../src/parsers/tailwind/index.js';
import {
  extractManagedBlock,
  generateAgentsMd,
  generateClaudeMd,
  generateCursorrules,
  GENERATORS,
  getGenerator,
  MARKDOWN_MARKERS,
  mergeManagedBlock,
  syncClaudeMd,
  TEXT_MARKERS,
} from '../../src/generators/index.js';

/** A small but complete design system, so snapshots stay readable. */
function acmeDesignSystem(): DesignSystem {
  return createDesignSystem({
    meta: {
      name: 'Acme',
      version: '2.1.0',
      source: 'style-dictionary',
      parsedAt: '2026-01-15T09:00:00.000Z',
    },
    tokens: {
      spacing: createSpacingScale([
        { name: 'none', value: '0px' },
        { name: 'xs', value: '4px' },
        { name: 'sm', value: '8px' },
        { name: 'md', value: '16px' },
        { name: 'lg', value: '24px' },
        { name: 'xl', value: '32px' },
        { name: 'legacy', value: '13px', deprecated: true },
      ]),
      color: createColorSystem([
        { name: 'blue-500', value: '#3b82f6' },
        { name: 'blue-600', value: '#2563eb' },
        { name: 'gray-500', value: '#6b7280' },
        {
          name: 'text-secondary',
          value: '#6b7280',
          reference: 'gray-500',
          description: 'Muted body copy',
        },
        { name: 'surface', value: '#ffffff' },
      ]),
      borderRadius: createScaleTokens([
        { name: 'sm', value: '2px' },
        { name: 'md', value: '6px' },
      ]),
      shadow: createShadowSystem([{ name: 'card', value: '0 4px 6px rgba(0, 0, 0, 0.1)' }]),
      typography: createTypographySystem({
        fontFamilies: createNamedTokens([{ name: 'sans', value: 'Inter, system-ui, sans-serif' }]),
        fontSizes: createScaleTokens([
          { name: 'base', value: '16px' },
          { name: 'lg', value: '20px' },
        ]),
        fontWeights: createNamedTokens([{ name: 'bold', value: '700' }]),
      }),
    },
    components: {
      Button: {
        name: 'Button',
        variants: { variant: ['primary', 'secondary', 'ghost'], size: ['sm', 'md', 'lg'] },
        requiredProps: ['children'],
        source: 'cva',
      },
      Card: { name: 'Card', variants: {}, requiredProps: [], source: 'config' },
    },
    compositionRules: [
      { id: 'no-nested-card', parent: 'Card', forbiddenDescendants: ['Card'], severity: 'error' },
      { id: 'list-children', parent: 'List', allowedChildren: ['ListItem'], severity: 'error' },
    ],
    antiPatterns: [
      {
        id: 'no-legacy-modal',
        description: 'LegacyModal is being retired.',
        fix: 'Use `Dialog`.',
        matcher: { kind: 'jsx-element', element: 'LegacyModal' },
        severity: 'error',
      },
    ],
  });
}

const acme = acmeDesignSystem();

describe('generateClaudeMd', () => {
  it('matches its snapshot', () => {
    expect(generateClaudeMd(acme)).toMatchSnapshot();
  });

  it('names the design system and its source format', () => {
    const output = generateClaudeMd(acme);
    expect(output).toContain('**Acme**');
    expect(output).toContain('v2.1.0');
  });

  it('states the inferred base unit', () => {
    // 4, 8, 16, 24, 32 -> 4px. An 8px step would leave 4 unexplained.
    expect(generateClaudeMd(acme)).toContain('Base unit: **4px**');
  });

  it('lists deprecated tokens separately instead of offering them', () => {
    const output = generateClaudeMd(acme);
    expect(output).toContain('Deprecated, do not use: `legacy`');
    expect(output).not.toContain('`legacy` (13px)');
  });

  it('spells out semantic colours but summarizes palette families', () => {
    const output = generateClaudeMd(acme);
    expect(output).toContain('`text-secondary`: #6b7280 → `gray-500`');
    expect(output).toContain('`blue-*`: 500, 600');
  });

  it('renders composition rules as prose an agent can follow', () => {
    const output = generateClaudeMd(acme);
    expect(output).toContain('`Card` must never contain `Card` at any depth.');
    expect(output).toContain('`List` accepts only `ListItem` as direct children.');
  });

  it('includes the enforced rules', () => {
    expect(generateClaudeMd(acme)).toContain('**no-arbitrary-spacing**');
  });

  it('can narrow the rules section to what is actually enabled', () => {
    const output = generateClaudeMd(acme, { enabledRules: ['no-inline-styles'] });
    expect(output).toContain('**no-inline-styles**');
    expect(output).not.toContain('**no-arbitrary-spacing**');
  });

  it('includes project anti-patterns with their fix', () => {
    const output = generateClaudeMd(acme);
    expect(output).toContain('LegacyModal is being retired.');
    expect(output).toContain('Instead: Use `Dialog`.');
  });

  it('appends extra instructions verbatim', () => {
    const output = generateClaudeMd(acme, { extraInstructions: 'Always use the `cn()` helper.' });
    expect(output).toContain('Always use the `cn()` helper.');
  });
});

describe('generateAgentsMd', () => {
  it('matches its snapshot', () => {
    expect(generateAgentsMd(acme)).toMatchSnapshot();
  });

  it('is a complete document with a top-level heading', () => {
    expect(generateAgentsMd(acme).startsWith('# Design system')).toBe(true);
  });
});

describe('generateCursorrules', () => {
  it('matches its snapshot', () => {
    expect(generateCursorrules(acme)).toMatchSnapshot();
  });

  it('puts the hard rules before the token reference', () => {
    const output = generateCursorrules(acme);
    expect(output.indexOf('HARD RULES')).toBeLessThan(output.indexOf('Design system reference'));
  });

  it('flattens Markdown tables, which Cursor renders as noise', () => {
    const output = generateCursorrules(acme);
    expect(output).not.toContain('| --- |');
    expect(output).toContain('`Button`');
    expect(output).toContain('variant: primary');
  });
});

describe('determinism', () => {
  it.each(GENERATORS.map((generator) => [generator.displayName, generator] as const))(
    '%s produces identical bytes for identical input',
    (_name, generator) => {
      expect(generator.generate(acme)).toBe(generator.generate(acmeDesignSystem()));
    },
  );

  it('omits the parse timestamp by default, so sync does not churn the diff', () => {
    for (const generator of GENERATORS) {
      expect(generator.generate(acme)).not.toContain('2026-01-15');
    }
  });

  it('includes the timestamp only when explicitly asked', () => {
    expect(generateClaudeMd(acme, { includeTimestamp: true })).toContain(
      '2026-01-15T09:00:00.000Z',
    );
  });

  it('is unaffected by when the design system was parsed', () => {
    const later = createDesignSystem({
      ...acmeDesignSystem(),
      meta: { ...acme.meta, parsedAt: '2030-06-01T00:00:00.000Z' },
    });
    expect(generateClaudeMd(later)).toBe(generateClaudeMd(acme));
  });
});

describe('context budget', () => {
  // Tailwind's defaults carry 247 colours and 35 spacing steps. Dumping them
  // verbatim would bury the rules that actually change agent behaviour.
  const tailwind = parseTailwindV3({
    path: 'tailwind.config.js',
    content: 'module.exports = {};',
  }).designSystem;

  it('summarizes a full Tailwind theme instead of enumerating it', () => {
    const output = generateClaudeMd(tailwind);
    const hexCount = (output.match(/#[0-9a-f]{6}/gi) ?? []).length;

    expect(tailwind.tokens.color.tokens.length).toBeGreaterThan(200);
    expect(hexCount).toBeLessThan(30);
  });

  it('keeps the generated file small enough to be worth loading every request', () => {
    expect(generateClaudeMd(tailwind).length).toBeLessThan(8_000);
  });

  it('does not tell the agent to prefer CSS keywords, which carry no design intent', () => {
    const colour = generateClaudeMd(tailwind).split('### Colour')[1] ?? '';
    const prefer = colour.split('**Palette.**')[0] ?? '';

    expect(prefer).not.toContain('`inherit`');
    expect(prefer).not.toContain('`current`');
    expect(colour).toContain('CSS keywords, valid but carrying no design intent');
  });

  it('never renders a translucent colour as its opaque hex', () => {
    const translucent = createDesignSystem({
      meta: { name: 'T', source: 'unknown' },
      tokens: {
        color: createColorSystem([
          { name: 'overlay', value: 'rgba(0, 0, 0, 0.5)' },
          { name: 'clear', value: 'transparent' },
        ]),
      },
    });
    const output = generateClaudeMd(translucent);

    // `transparent` resolves to #000000 with alpha 0; printing the hex would
    // tell the agent it is black.
    expect(output).toContain('`overlay`: rgba(0, 0, 0, 0.5)');
    expect(output).not.toMatch(/`overlay`: #000000/);
    expect(output).not.toMatch(/`clear`: #000000/);
  });

  it('still names every palette family so the agent recognizes them', () => {
    const output = generateClaudeMd(tailwind);
    expect(output).toContain('`blue-*`');
    expect(output).toContain('`slate-*`');
  });

  it('respects an explicit per-group cap', () => {
    const output = generateClaudeMd(tailwind, { maxTokensPerGroup: 5 });
    expect(output).toContain('and 30 more');
  });

  it('describes a Tailwind v4 computed scale as computed, not as a fixed list', () => {
    const v4 = createDesignSystem({
      meta: { name: 'V4', source: 'tailwind' },
      tokens: {
        spacing: createSpacingScale([{ name: '1', value: '4px' }], { dynamicMultiplier: 4 }),
      },
    });
    expect(generateClaudeMd(v4)).toContain('computed scale');
    expect(generateClaudeMd(v4)).toContain('`p-13` is legitimate here');
  });
});

describe('empty design systems', () => {
  const empty = createDesignSystem({ meta: { name: 'Empty', source: 'unknown' } });

  it('omits sections with nothing to say rather than emitting empty headings', () => {
    const output = generateClaudeMd(empty);
    expect(output).not.toContain('### Spacing');
    expect(output).not.toContain('### Colour');
  });

  it('still emits the rules, which are useful with or without tokens', () => {
    expect(generateClaudeMd(empty)).toContain('### Rules');
  });
});

describe('mergeManagedBlock', () => {
  it('creates the file when there is nothing there', () => {
    const result = mergeManagedBlock(null, 'GENERATED');
    expect(result.outcome).toBe('created');
    expect(result.content).toContain(MARKDOWN_MARKERS.start);
    expect(result.content).toContain('GENERATED');
  });

  it('appends after existing content, leaving the team’s own text on top', () => {
    const result = mergeManagedBlock('# My project\n\nSome notes.\n', 'GENERATED');
    expect(result.outcome).toBe('appended');
    expect(result.content.startsWith('# My project')).toBe(true);
    expect(result.content).toContain('GENERATED');
  });

  it('replaces only the managed block, preserving text on both sides', () => {
    const first = mergeManagedBlock('# Mine\n\nBefore.\n', 'OLD').content;
    const withTrailing = `${first}\nAfter the block.\n`;
    const second = mergeManagedBlock(withTrailing, 'NEW');

    expect(second.outcome).toBe('replaced');
    expect(second.content).toContain('Before.');
    expect(second.content).toContain('After the block.');
    expect(second.content).toContain('NEW');
    expect(second.content).not.toContain('OLD');
  });

  it('is idempotent, so running sync twice is a no-op', () => {
    const once = mergeManagedBlock('# Mine\n', 'GENERATED').content;
    const twice = mergeManagedBlock(once, 'GENERATED');
    expect(twice.content).toBe(once);
    expect(twice.outcome).toBe('unchanged');
  });

  it('never duplicates the block across repeated syncs', () => {
    let content = mergeManagedBlock(null, 'GENERATED').content;
    for (let index = 0; index < 5; index += 1) {
      content = mergeManagedBlock(content, 'GENERATED').content;
    }
    expect(content.split(MARKDOWN_MARKERS.start)).toHaveLength(2);
  });

  it('warns rather than silently eating the file when the end marker is missing', () => {
    const damaged = `# Mine\n\n${MARKDOWN_MARKERS.start}\nhalf a block\n\nimportant trailing notes\n`;
    const result = mergeManagedBlock(damaged, 'NEW');

    expect(result.warning).toContain('no matching');
    expect(result.warning).toContain('check the result before committing');
    expect(result.content).toContain('# Mine');
  });

  it('uses hash markers for plain-text targets', () => {
    const result = mergeManagedBlock(null, 'GENERATED', TEXT_MARKERS);
    expect(result.content).toContain('# anchor:start');
    expect(result.content).not.toContain('<!--');
  });

  it('tells humans the block is generated', () => {
    expect(mergeManagedBlock(null, 'X').content).toContain('will be overwritten');
  });
});

describe('extractManagedBlock', () => {
  it('round-trips the generated content', () => {
    const merged = mergeManagedBlock('# Mine\n', 'GENERATED BODY').content;
    expect(extractManagedBlock(merged)).toContain('GENERATED BODY');
  });

  it('returns null when there is no block', () => {
    expect(extractManagedBlock('# Just my notes')).toBeNull();
  });
});

describe('syncClaudeMd', () => {
  it('embeds the generated design system inside the markers', () => {
    const result = syncClaudeMd(acme, '# Acme app\n\nRun `pnpm dev`.\n');
    expect(result.content).toContain('Run `pnpm dev`.');
    expect(result.content).toContain('## Design system');
    expect(extractManagedBlock(result.content)).toContain('Base unit');
  });
});

describe('getGenerator', () => {
  it('resolves each known target', () => {
    expect(getGenerator('claude-md').defaultPath).toBe('CLAUDE.md');
    expect(getGenerator('cursorrules').defaultPath).toBe('.cursorrules');
    expect(getGenerator('agents-md').defaultPath).toBe('AGENTS.md');
  });

  it('throws on an unknown target', () => {
    // @ts-expect-error deliberately invalid target
    expect(() => getGenerator('nope')).toThrow(/Unknown generator target/);
  });
});
