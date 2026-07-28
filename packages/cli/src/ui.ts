/**
 * Anchor's voice in the terminal.
 *
 * The tone is confident and plain: an emoji as a signpost, never as decoration,
 * and sentences that tell you what happened and what to do next. A design
 * system tool that looks careless in its own output is not making a good case
 * for itself.
 *
 * Everything degrades gracefully. Colour and emoji are decided once, from the
 * environment, and when they are off the output is still perfectly readable —
 * which matters because most of these lines end up in a CI log, not a terminal.
 */

const ANSI = {
  reset: '\u001B[0m',
  bold: '\u001B[1m',
  dim: '\u001B[2m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  magenta: '\u001B[35m',
  cyan: '\u001B[36m',
  grey: '\u001B[90m',
} as const;

type Style = keyof typeof ANSI;

export interface UiOptions {
  color: boolean;
  emoji: boolean;
  /** Suppresses everything except errors and machine-readable output. */
  quiet: boolean;
}

/**
 * Emoji are paired with an ASCII fallback rather than simply dropped, so a
 * plain-text log keeps the same structure and scannability.
 */
const SIGNS = {
  anchor: ['⚓', ''],
  palette: ['🎨', '#'],
  search: ['🔍', '>'],
  write: ['📝', '>'],
  sparkle: ['✨', '*'],
  rocket: ['🚀', '>'],
  lock: ['🔒', '#'],
  bolt: ['⚡', '>'],
  wrench: ['🔧', '>'],
  ok: ['✔', 'ok'],
  fail: ['✖', 'x'],
  warn: ['▲', '!'],
  bullet: ['·', '-'],
  arrow: ['→', '->'],
} as const;

export type Sign = keyof typeof SIGNS;

export class Ui {
  constructor(
    private readonly options: UiOptions,
    private readonly out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly err: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  ) {}

  get colorEnabled(): boolean {
    return this.options.color;
  }

  get emojiEnabled(): boolean {
    return this.options.emoji;
  }

  paint(text: string, style: Style): string {
    return this.options.color ? `${ANSI[style]}${text}${ANSI.reset}` : text;
  }

  sign(name: Sign): string {
    const [emoji, fallback] = SIGNS[name];
    return this.options.emoji ? emoji : fallback;
  }

  /** Writes a line to stdout unless running quiet. */
  line(text = ''): void {
    if (!this.options.quiet) this.out(text);
  }

  /** Writes regardless of `quiet`, for output the user explicitly asked for. */
  always(text: string): void {
    this.out(text);
  }

  /** Writes to stderr, so it survives `> file` and never pollutes piped data. */
  stderr(text: string): void {
    this.err(text);
  }

  /** The product banner. One per command, at the top. */
  banner(command?: string): void {
    const name = this.paint('Anchor', 'bold');
    const suffix =
      command === undefined
        ? ''
        : `  ${this.paint(this.sign('bullet'), 'grey')}  ${this.paint(command, 'grey')}`;
    this.line();
    this.line(`${this.sign('anchor')} ${name}${suffix}`.trim());
    this.line();
  }

  /** A headline for a phase of work. */
  step(sign: Sign, text: string): void {
    this.line(`${this.sign(sign)} ${text}`.trim());
  }

  /** An indented success line. */
  ok(text: string): void {
    this.line(`   ${this.paint(this.sign('ok'), 'green')} ${text}`);
  }

  /** An indented informational line, subordinate to the step above it. */
  detail(text: string): void {
    this.line(`   ${this.paint(text, 'grey')}`);
  }

  warn(text: string): void {
    this.line(`   ${this.paint(this.sign('warn'), 'yellow')} ${text}`);
  }

  /** A failure. Goes to stderr so scripts can separate it from real output. */
  fail(text: string): void {
    this.stderr(`${this.paint(this.sign('fail'), 'red')} ${text}`);
  }

  /** A horizontal rule, for separating a violation list from its summary. */
  rule(width = 56): void {
    this.line(this.paint('─'.repeat(width), 'grey'));
  }

  /** The closing privacy line. It is the product's core promise, so it is stated. */
  privacyNote(): void {
    this.line();
    this.line(
      this.paint(
        `${this.sign('lock')} Everything ran locally. Nothing left this machine.`.trim(),
        'grey',
      ),
    );
  }

  /** A numbered list of what to do next. */
  nextSteps(steps: readonly { command: string; description: string }[]): void {
    if (steps.length === 0) return;
    this.line();
    this.step('rocket', this.paint('Next', 'bold'));

    const width = Math.max(...steps.map((entry) => entry.command.length));
    for (const [index, entry] of steps.entries()) {
      const command = this.paint(entry.command.padEnd(width), 'cyan');
      this.line(`   ${this.paint(`${index + 1}.`, 'grey')} ${command}  ${entry.description}`);
    }
  }
}

/**
 * Decides colour and emoji from the environment.
 *
 * `NO_COLOR` is honoured above everything else because it is a standard and
 * users who set it mean it. CI gets plain output: colour codes and emoji in a
 * build log are noise at best and mojibake at worst.
 */
export function resolveUiOptions(
  env: Readonly<Record<string, string | undefined>>,
  isTty: boolean,
  overrides: { color?: boolean; emoji?: boolean; quiet?: boolean } = {},
): UiOptions {
  const noColor = env['NO_COLOR'] !== undefined && env['NO_COLOR'] !== '';
  const forceColor = env['FORCE_COLOR'] !== undefined && env['FORCE_COLOR'] !== '0';
  const inCi = env['CI'] !== undefined && env['CI'] !== '';

  const color = overrides.color ?? (noColor ? false : forceColor ? true : isTty && !inCi);
  // Windows terminals below Windows Terminal render most emoji as boxes.
  const legacyWindows = process.platform === 'win32' && env['WT_SESSION'] === undefined;
  const emoji = overrides.emoji ?? (isTty && !inCi && !legacyWindows);

  return { color, emoji, quiet: overrides.quiet ?? false };
}

/** Formats a duration the way a person reads it. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** `1,234` — thousands separators, so large counts stay readable. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}
