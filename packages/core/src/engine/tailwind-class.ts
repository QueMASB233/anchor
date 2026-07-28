/**
 * Parsing a single Tailwind utility class.
 *
 * `md:hover:!-mt-[13px]` has to be decomposed before any rule can reason about
 * it. Getting this wrong in either direction is costly: too strict and real
 * violations are missed, too loose and the linter cries wolf on valid code.
 *
 * Arbitrary variants (`[&>*]:p-4`) mean the variant separator cannot simply be
 * split on `:` — the brackets have to be respected.
 */

export interface ParsedClass {
  /** The class exactly as written. */
  raw: string;
  /** Variant prefixes in source order, e.g. `['md', 'hover']`. */
  variants: string[];
  /** `!` marker, in either the v3 (leading) or v4 (trailing) position. */
  important: boolean;
  /** Leading `-`, as in `-mt-2`. */
  negative: boolean;
  /** The utility with variants, `!` and `-` stripped, e.g. `mt-[13px]`. */
  base: string;
  /** Text inside `[...]`, or `null` for a scale-based utility. */
  arbitrary: string | null;
}

/** Splits on `:` at bracket depth zero, so `[&>*]:p-4` survives intact. */
function splitVariants(className: string): { variants: string[]; base: string } {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const character of className) {
    if (character === '[' || character === '(') depth += 1;
    else if (character === ']' || character === ')') depth -= 1;

    if (character === ':' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }

  return { variants: parts, base: current };
}

/** Extracts the contents of a trailing `[...]`, honouring nesting. */
function extractArbitrary(base: string): string | null {
  const open = base.indexOf('[');
  if (open === -1 || !base.endsWith(']')) return null;
  return base.slice(open + 1, -1);
}

export function parseClass(raw: string): ParsedClass {
  const { variants, base: afterVariants } = splitVariants(raw);

  let base = afterVariants;
  let important = false;

  if (base.startsWith('!')) {
    important = true;
    base = base.slice(1);
  }
  if (base.endsWith('!')) {
    important = true;
    base = base.slice(0, -1);
  }

  const negative = base.startsWith('-');
  if (negative) base = base.slice(1);

  return { raw, variants, important, negative, base, arbitrary: extractArbitrary(base) };
}

/**
 * Matches a utility against a set of known prefixes, longest first.
 *
 * Longest-first matters: `space-x` must win over `space`, and `p` must not
 * swallow `px`. Returns `null` when nothing matches.
 */
export function matchUtility(
  base: string,
  prefixes: readonly string[],
): { utility: string; value: string } | null {
  let best: { utility: string; value: string } | null = null;

  for (const prefix of prefixes) {
    if (!base.startsWith(`${prefix}-`)) continue;
    if (best !== null && prefix.length <= best.utility.length) continue;
    best = { utility: prefix, value: base.slice(prefix.length + 1) };
  }

  return best;
}

/**
 * Utilities that consume a value from the spacing scale.
 *
 * Deliberately a closed list. Inferring "does this utility take spacing?" from
 * the class name alone would misfire on things like `border-2` and `z-10`,
 * which look identical in shape but come from different scales entirely.
 */
export const SPACING_UTILITIES: readonly string[] = [
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'inset',
  'inset-x',
  'inset-y',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'w',
  'h',
  'size',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'translate-x',
  'translate-y',
  'scroll-m',
  'scroll-mx',
  'scroll-my',
  'scroll-mt',
  'scroll-mr',
  'scroll-mb',
  'scroll-ml',
  'scroll-p',
  'scroll-px',
  'scroll-py',
  'scroll-pt',
  'scroll-pr',
  'scroll-pb',
  'scroll-pl',
  'indent',
  'basis',
];

/** Utilities that take a colour. */
export const COLOR_UTILITIES: readonly string[] = [
  'bg',
  'text',
  'border',
  'border-x',
  'border-y',
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'ring',
  'ring-offset',
  'outline',
  'divide',
  'placeholder',
  'caret',
  'accent',
  'fill',
  'stroke',
  'shadow',
  'decoration',
  'from',
  'via',
  'to',
];

/** Utilities that take a border radius. */
export const RADIUS_UTILITIES: readonly string[] = [
  'rounded',
  'rounded-t',
  'rounded-r',
  'rounded-b',
  'rounded-l',
  'rounded-tl',
  'rounded-tr',
  'rounded-br',
  'rounded-bl',
  'rounded-s',
  'rounded-e',
  'rounded-ss',
  'rounded-se',
  'rounded-ee',
  'rounded-es',
];

/** Utilities that take a shadow. */
export const SHADOW_UTILITIES: readonly string[] = ['shadow', 'drop-shadow', 'inset-shadow'];

/**
 * Rebuilds a class string from its parts, preserving variants and modifiers.
 * Used by autofixes so `md:hover:p-[13px]` becomes `md:hover:p-3`, not `p-3`.
 */
export function formatClass(parsed: ParsedClass, newBase: string): string {
  const prefix = parsed.variants.length === 0 ? '' : `${parsed.variants.join(':')}:`;
  const important = parsed.important ? '!' : '';
  const negative = parsed.negative ? '-' : '';
  return `${prefix}${important}${negative}${newBase}`;
}
