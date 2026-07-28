/**
 * Colour value normalization.
 *
 * `#FFF`, `#ffffff`, `rgb(255 255 255)`, and `hsl(0 0% 100%)` are the same
 * colour. `no-raw-hex-colors` has to recognize that a hard-coded `#2D3748`
 * matches an existing token no matter which notation either side used, so
 * every colour is reduced to a lowercase 6-digit hex plus a separate alpha.
 *
 * Alpha is kept out of the hex deliberately: two colours that differ only in
 * opacity should still match against the same token.
 */

/** A colour reduced to a comparable canonical form. */
export interface NormalizedColor {
  /** Lowercase `#rrggbb`. Never carries alpha. */
  hex: string;
  /** Opacity from 0 to 1. */
  alpha: number;
}

/**
 * The 16 basic HTML colour keywords plus the handful that show up in real
 * stylesheets. The full 148-entry CSS named colour list is deliberately not
 * bundled: the long tail effectively never appears in design system code, and
 * a miss here degrades to "not a recognized colour" rather than to a wrong answer.
 */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
  cyan: '#00ffff',
  orange: '#ffa500',
};

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;

/** Clamps to a range, mapping NaN to the low bound. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function toHexPair(channel: number): string {
  return Math.round(clamp(channel, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHexPair(r)}${toHexPair(g)}${toHexPair(b)}`;
}

/** Parses one `rgb()` / `hsl()` argument, resolving percentages against `full`. */
function parseChannel(raw: string, full: number): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(percent) ? (percent / 100) * full : Number.NaN;
  }
  return Number.parseFloat(trimmed);
}

/** Parses an alpha argument, which may be a number (0–1) or a percentage. */
function parseAlpha(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = parseChannel(raw, 1);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

/**
 * Splits the inside of a colour function into components and an optional alpha,
 * accepting both legacy comma syntax (`rgba(0, 0, 0, 0.5)`) and modern slash
 * syntax (`rgb(0 0 0 / 50%)`).
 */
function splitColorArgs(body: string): { parts: string[]; alpha: string | undefined } {
  const [main, slashAlpha] = body.split('/');
  if (main === undefined) return { parts: [], alpha: undefined };

  const parts = main
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part !== '');

  if (slashAlpha !== undefined) {
    return { parts, alpha: slashAlpha.trim() };
  }
  // Legacy `rgba(r, g, b, a)` puts alpha in the fourth comma-separated slot.
  if (parts.length === 4) {
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  }
  return { parts, alpha: undefined };
}

/** Converts HSL to RGB. `h` in degrees, `s` and `l` in 0–1. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = l - chroma / 2;

  let rgb: [number, number, number];
  if (hue < 60) rgb = [chroma, secondary, 0];
  else if (hue < 120) rgb = [secondary, chroma, 0];
  else if (hue < 180) rgb = [0, chroma, secondary];
  else if (hue < 240) rgb = [0, secondary, chroma];
  else if (hue < 300) rgb = [secondary, 0, chroma];
  else rgb = [chroma, 0, secondary];

  return [(rgb[0] + match) * 255, (rgb[1] + match) * 255, (rgb[2] + match) * 255];
}

function normalizeHex(digits: string): NormalizedColor | null {
  const lower = digits.toLowerCase();

  switch (lower.length) {
    case 3:
    case 4: {
      const expanded = [...lower].map((c) => c + c).join('');
      const hex = `#${expanded.slice(0, 6)}`;
      const alpha = lower.length === 4 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
      return { hex, alpha };
    }
    case 6:
      return { hex: `#${lower}`, alpha: 1 };
    case 8:
      return { hex: `#${lower.slice(0, 6)}`, alpha: Number.parseInt(lower.slice(6, 8), 16) / 255 };
    default:
      // 5 and 7 digit hex values are not valid CSS.
      return null;
  }
}

/**
 * Reduces any supported colour notation to a canonical hex plus alpha.
 *
 * Returns `null` for values that do not denote a concrete colour — `inherit`,
 * `currentColor`, `var(--x)`, gradients, and anything unparseable. Callers must
 * treat `null` as "cannot compare" rather than guessing.
 *
 * `transparent` resolves to fully transparent black, matching CSS.
 */
export function normalizeColor(raw: string): NormalizedColor | null {
  const input = raw.trim().toLowerCase();
  if (input === '') return null;

  if (input === 'transparent') return { hex: '#000000', alpha: 0 };

  const named = NAMED_COLORS[input];
  if (named !== undefined) return { hex: named, alpha: 1 };

  const hexMatch = HEX_PATTERN.exec(input);
  if (hexMatch?.[1] !== undefined) return normalizeHex(hexMatch[1]);

  const fnMatch = /^(rgba?|hsla?)\((.*)\)$/s.exec(input);
  if (fnMatch === null) return null;

  const [, fn, body = ''] = fnMatch;
  const { parts, alpha: rawAlpha } = splitColorArgs(body);
  if (parts.length < 3) return null;

  const alpha = parseAlpha(rawAlpha);
  const [first = '', second = '', third = ''] = parts;

  if (fn === 'rgb' || fn === 'rgba') {
    const r = parseChannel(first, 255);
    const g = parseChannel(second, 255);
    const b = parseChannel(third, 255);
    if (![r, g, b].every(Number.isFinite)) return null;
    return { hex: rgbToHex(r, g, b), alpha };
  }

  // `hsl` / `hsla`. Hue is an angle, so it is never a percentage of anything.
  const h = Number.parseFloat(first.replace(/deg$/, ''));
  const s = parseChannel(second, 1);
  const l = parseChannel(third, 1);
  if (![h, s, l].every(Number.isFinite)) return null;

  const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
  return { hex: rgbToHex(r, g, b), alpha };
}

/** True when two colour values denote the same colour, ignoring notation. */
export function colorsEqual(a: string, b: string): boolean {
  const left = normalizeColor(a);
  const right = normalizeColor(b);
  if (left === null || right === null) return false;
  return left.hex === right.hex && left.alpha === right.alpha;
}
