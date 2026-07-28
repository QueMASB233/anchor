/**
 * Builds the shared content for every generated context file.
 *
 * The three targets (CLAUDE.md, .cursorrules, AGENTS.md) differ in framing and
 * syntax, not in substance, so the substance is assembled once here and each
 * renderer presents it.
 *
 * Two constraints shape everything below.
 *
 * CONTEXT BUDGET. These files are read by a model with finite attention, and
 * they are read on *every* request. Tailwind's default theme alone carries 247
 * colours; listing them all would bury the eight rules that actually change
 * behaviour under a wall of hex codes. Palettes are therefore summarized by
 * family, semantic tokens are listed in full because they are what we want the
 * agent to reach for, and every group has a cap.
 *
 * DETERMINISM. `anchor sync` output is committed. Identical input must produce
 * byte-identical output, or every run shows up as a diff and teams stop running
 * it. Nothing here reads the clock, and token order follows the parser rather
 * than being re-sorted.
 */

import type {
  ColorToken,
  ComponentDefinition,
  CompositionRule,
  DesignSystem,
  NamedTokens,
  ScaleTokens,
  SpacingScale,
} from '../model/index.js';

export interface Section {
  /** Heading text, without any leading `#`. */
  title: string;
  /** Markdown body. Never empty; sections with nothing to say are omitted. */
  body: string;
}

export interface GeneratorOptions {
  /**
   * Rule ids that are enabled, used to tailor the rules section. Defaults to
   * every rule Anchor ships, so a generated file is useful before any config
   * exists.
   */
  enabledRules?: readonly string[];
  /** Cap on entries listed per token group before summarizing. */
  maxTokensPerGroup?: number;
  /** Appended verbatim as a final section. */
  extraInstructions?: string;
  /**
   * Stamp the design system's `parsedAt` into the output.
   *
   * Off by default and deliberately so: a timestamp makes every `anchor sync`
   * produce a diff even when the design system has not changed, which trains
   * teams to ignore the file.
   */
  includeTimestamp?: boolean;
}

const DEFAULT_MAX_TOKENS_PER_GROUP = 48;

/** Guidance emitted for each built-in rule, keyed by rule id. */
export const RULE_GUIDANCE: Readonly<Record<string, string>> = {
  'no-arbitrary-spacing':
    'Never use arbitrary spacing values such as `p-[13px]`, `gap-[7px]` or `m-[3rem]`. Every spacing utility must come from the scale above.',
  'no-raw-hex-colors':
    'Never hard-code a colour, in a class (`bg-[#2D3748]`) or a style object. Use a colour token.',
  'use-design-tokens':
    'Prefer semantic tokens over raw palette values: `text-secondary` rather than `text-gray-500`. Semantic tokens survive a rebrand; palette values do not.',
  'no-inline-styles':
    'Never use `style={{ ... }}`. Use utility classes, or extend the component so the variation is part of its API.',
  'valid-component-variants':
    'Only pass variant values that the component actually declares. Inventing one silently falls back to the default styling.',
  'composition-rules':
    'Respect the composition rules above. Nesting a component inside itself is almost always a layout mistake.',
  'no-custom-shadows':
    'Never use arbitrary shadows such as `shadow-[0_4px_8px_rgba(0,0,0,0.1)]`. Use a shadow token.',
  'heading-order':
    'Keep heading levels sequential. Never jump from `h1` to `h3`; screen reader users navigate by that structure.',
};

/**
 * CSS-wide keywords that a token file may legitimately contain but that carry
 * no design intent. Listing `inherit` or `currentColor` under "prefer these"
 * would be actively bad guidance, so they are called out separately.
 */
const CSS_KEYWORDS = new Set([
  'inherit',
  'currentcolor',
  'transparent',
  'unset',
  'initial',
  'revert',
]);

function isCssKeyword(token: ColorToken): boolean {
  return CSS_KEYWORDS.has(token.value.trim().toLowerCase());
}

/**
 * Renders a colour honestly.
 *
 * The resolved hex is used only when it tells the whole truth. A translucent
 * token would otherwise be shown as its opaque hex — `transparent` printing as
 * `#000000` is worse than useless.
 */
function displayColor(token: ColorToken): string {
  if (token.hex === null || token.alpha < 1) return token.value;
  return token.hex;
}

/** Escapes the characters that would break a Markdown table cell. */
export function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Renders `items`, capped at `max`, with a note about what was left out. */
function capped(items: readonly string[], max: number): string {
  if (items.length <= max) return items.join(', ');
  const shown = items.slice(0, max).join(', ');
  return `${shown} … and ${items.length - max} more`;
}

function spacingSection(scale: SpacingScale, max: number): Section | null {
  if (scale.tokens.length === 0) return null;

  const lines: string[] = [];

  if (scale.dynamicMultiplier !== null) {
    lines.push(
      `This is a **computed scale**: the base step is \`${scale.dynamicMultiplier}px\`, and any whole multiple of it is valid. \`p-13\` is legitimate here.`,
    );
  } else if (scale.baseUnit !== null) {
    const confidence =
      scale.confidence === 'high' || scale.confidence === 'medium'
        ? ''
        : ' (inferred from few values, so treat it as approximate)';
    lines.push(`Base unit: **${scale.baseUnit}px**${confidence}.`);

    if (scale.outliers.length > 0) {
      lines.push(
        `Off-grid by design: ${scale.outliers.map((value) => `\`${value}px\``).join(', ')}.`,
      );
    }
  }

  const entries = scale.tokens
    .filter((token) => token.deprecated !== true)
    .map((token) =>
      token.px === null ? `\`${token.name}\`` : `\`${token.name}\` (${token.px}px)`,
    );

  lines.push('', `Allowed values: ${capped(entries, max)}`);

  const deprecated = scale.tokens.filter((token) => token.deprecated === true);
  if (deprecated.length > 0) {
    lines.push('', `Deprecated, do not use: ${deprecated.map((t) => `\`${t.name}\``).join(', ')}`);
  }

  return { title: 'Spacing', body: lines.join('\n') };
}

/**
 * Colours, with semantic tokens listed in full and palettes summarized.
 *
 * The asymmetry is intentional. Semantic tokens are what we want the agent to
 * use, so they are spelled out. Palette entries exist mostly so the agent can
 * recognize one when it sees it, which a family summary achieves at a fraction
 * of the size.
 */
function colorSection(tokens: readonly ColorToken[], max: number): Section | null {
  const live = tokens.filter((token) => token.deprecated !== true);
  if (live.length === 0) return null;

  const semantic = live.filter((token) => token.kind === 'semantic' && !isCssKeyword(token));
  const keywords = live.filter(isCssKeyword);
  const palette = live.filter((token) => token.kind === 'palette' && !isCssKeyword(token));
  const lines: string[] = [];

  if (semantic.length > 0) {
    lines.push('**Semantic tokens — prefer these.**', '');
    for (const token of semantic.slice(0, max)) {
      const reference = token.reference === undefined ? '' : ` → \`${token.reference}\``;
      const description = token.description === undefined ? '' : ` — ${token.description}`;
      lines.push(`- \`${token.name}\`: ${displayColor(token)}${reference}${description}`);
    }
    if (semantic.length > max) lines.push(`- … and ${semantic.length - max} more`);
  }

  if (palette.length > 0) {
    const families = new Map<string, ColorToken[]>();
    for (const token of palette) {
      const family = token.family ?? token.name;
      families.set(family, [...(families.get(family) ?? []), token]);
    }

    if (semantic.length > 0) lines.push('');
    lines.push('**Palette.**', '');

    for (const [family, members] of families) {
      const shades = members
        .map((token) => token.shade)
        .filter((shade): shade is string => shade !== undefined);

      if (shades.length === 0) {
        const only = members[0];
        lines.push(`- \`${family}\`: ${only === undefined ? '' : displayColor(only)}`);
        continue;
      }
      lines.push(`- \`${family}-*\`: ${shades.join(', ')}`);
    }
  }

  if (keywords.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `CSS keywords, valid but carrying no design intent: ${keywords
        .map((token) => `\`${token.name}\``)
        .join(', ')}.`,
    );
  }

  return { title: 'Colour', body: lines.join('\n') };
}

function scaleSection(title: string, scale: ScaleTokens, max: number): Section | null {
  const live = scale.tokens.filter((token) => token.deprecated !== true);
  if (live.length === 0) return null;

  const entries = live.map((token) => `\`${token.name}\` (${token.value})`);
  return { title, body: `Allowed values: ${capped(entries, max)}` };
}

function namedSection(title: string, tokens: NamedTokens, max: number): Section | null {
  const live = tokens.tokens.filter((token) => token.deprecated !== true);
  if (live.length === 0) return null;

  const entries = live.map((token) => `\`${token.name}\` (${escapeCell(token.value)})`);
  return { title, body: `Allowed values: ${capped(entries, max)}` };
}

function componentSection(
  components: Readonly<Record<string, ComponentDefinition>>,
  max: number,
): Section | null {
  const entries = Object.values(components);
  if (entries.length === 0) return null;

  const lines = ['| Component | Variants | Required props |', '| --- | --- | --- |'];

  for (const component of entries.slice(0, max)) {
    const variants = Object.entries(component.variants)
      .map(([dimension, values]) => `${dimension}: ${values.join(' \\| ')}`)
      .join('<br>');

    lines.push(
      `| \`${escapeCell(component.name)}\` | ${variants === '' ? '—' : variants} | ${
        component.requiredProps.length === 0 ? '—' : component.requiredProps.join(', ')
      } |`,
    );
  }

  if (entries.length > max) lines.push(`\n… and ${entries.length - max} more components.`);

  return { title: 'Components', body: lines.join('\n') };
}

function compositionSection(rules: readonly CompositionRule[]): Section | null {
  const active = rules.filter((rule) => rule.severity !== 'off');
  if (active.length === 0) return null;

  const lines = active.map((rule) => {
    if (rule.message !== undefined) return `- ${rule.message}`;

    const parts: string[] = [];
    if (rule.forbiddenDescendants !== undefined && rule.forbiddenDescendants.length > 0) {
      parts.push(
        `must never contain ${rule.forbiddenDescendants.map((n) => `\`${n}\``).join(', ')} at any depth`,
      );
    }
    if (rule.forbiddenChildren !== undefined && rule.forbiddenChildren.length > 0) {
      parts.push(
        `must not have ${rule.forbiddenChildren.map((n) => `\`${n}\``).join(', ')} as a direct child`,
      );
    }
    if (rule.allowedChildren !== undefined) {
      parts.push(
        `accepts only ${rule.allowedChildren.map((n) => `\`${n}\``).join(', ')} as direct children`,
      );
    }
    return `- \`${rule.parent}\` ${parts.join('; ')}.`;
  });

  return { title: 'Composition rules', body: lines.join('\n') };
}

function rulesSection(enabled: readonly string[]): Section | null {
  const lines = enabled
    .map((id) => {
      const guidance = RULE_GUIDANCE[id];
      return guidance === undefined ? null : `- **${id}** — ${guidance}`;
    })
    .filter((line): line is string => line !== null);

  if (lines.length === 0) return null;

  return {
    title: 'Rules',
    body: [
      'These are enforced automatically on every pull request. Code that breaks them will be flagged before review.',
      '',
      ...lines,
    ].join('\n'),
  };
}

function antiPatternSection(system: DesignSystem): Section | null {
  const patterns = (system.antiPatterns ?? []).filter((pattern) => pattern.severity !== 'off');
  if (patterns.length === 0) return null;

  const lines = patterns.map((pattern) => {
    const fix = pattern.fix === undefined ? '' : ` Instead: ${pattern.fix}`;
    return `- **${pattern.id}** — ${pattern.description}${fix}`;
  });

  return { title: 'Project-specific anti-patterns', body: lines.join('\n') };
}

/** Every rule Anchor ships, used when the caller does not narrow the list. */
export const ALL_RULE_IDS: readonly string[] = Object.keys(RULE_GUIDANCE);

/** Assembles the sections shared by all three generated files. */
export function buildSections(
  system: DesignSystem,
  options: GeneratorOptions = {},
): { sections: Section[]; summary: string } {
  const max = options.maxTokensPerGroup ?? DEFAULT_MAX_TOKENS_PER_GROUP;
  const { tokens } = system;

  const sections: (Section | null)[] = [
    spacingSection(tokens.spacing, max),
    colorSection(tokens.color.tokens, max),
    scaleSection('Border radius', tokens.borderRadius, max),
    tokens.shadow === undefined
      ? null
      : scaleSection(
          'Shadow',
          { tokens: tokens.shadow.tokens.map((t) => ({ ...t, px: null })) },
          max,
        ),
    namedSection('Font family', tokens.typography.fontFamilies, max),
    scaleSection('Font size', tokens.typography.fontSizes, max),
    namedSection('Font weight', tokens.typography.fontWeights, max),
    namedSection('Line height', tokens.typography.lineHeights, max),
    scaleSection('Letter spacing', tokens.typography.letterSpacings, max),
    system.components === undefined ? null : componentSection(system.components, max),
    system.compositionRules === undefined ? null : compositionSection(system.compositionRules),
    antiPatternSection(system),
    rulesSection(options.enabledRules ?? ALL_RULE_IDS),
  ];

  if (options.extraInstructions !== undefined && options.extraInstructions.trim() !== '') {
    sections.push({
      title: 'Additional project instructions',
      body: options.extraInstructions.trim(),
    });
  }

  const version = system.meta.version === undefined ? '' : ` v${system.meta.version}`;
  const stamp =
    options.includeTimestamp === true ? ` Generated from \`${system.meta.parsedAt}\`.` : '';

  const summary =
    `This project uses the **${system.meta.name}**${version} design system, defined in ` +
    `${system.meta.source === 'unknown' ? 'the project source' : `\`${system.meta.source}\``} format. ` +
    `Follow it exactly when writing or modifying UI code: use the tokens below rather than ad-hoc values.${stamp}`;

  return { sections: sections.filter((section): section is Section => section !== null), summary };
}
