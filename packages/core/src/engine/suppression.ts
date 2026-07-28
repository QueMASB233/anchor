/**
 * Inline suppression comments.
 *
 * A linter without an escape hatch gets disabled wholesale the first time it is
 * wrong, so Anchor supports the conventional forms:
 *
 *   // anchor-disable-next-line no-arbitrary-spacing
 *   <div className="p-[13px]" />          // anchor-disable-line
 *   \/* anchor-disable *\/ ... \/* anchor-enable *\/
 *   // anchor-disable-file no-inline-styles
 *
 * Listing rule ids narrows the suppression; omitting them suppresses every
 * rule on that line, which is blunt but occasionally what a team wants.
 */

import type { TSESTree } from '@typescript-eslint/typescript-estree';

type Directive = 'disable-next-line' | 'disable-line' | 'disable' | 'enable' | 'disable-file';

const DIRECTIVE_PATTERN =
  /anchor-(disable-next-line|disable-line|disable-file|disable|enable)\b([^*]*)/;

interface ParsedDirective {
  kind: Directive;
  rules: string[];
  line: number;
}

/** `null` in a rule set means "every rule". */
type RuleSet = Set<string> | null;

function parseDirective(comment: TSESTree.Comment): ParsedDirective | null {
  const match = DIRECTIVE_PATTERN.exec(comment.value);
  if (match?.[1] === undefined) return null;

  const rules = (match[2] ?? '')
    .split(/[\s,]+/)
    .map((rule) => rule.trim())
    .filter((rule) => rule !== '' && rule !== '--');

  return { kind: match[1] as Directive, rules, line: comment.loc.start.line };
}

function matches(set: RuleSet, ruleId: string): boolean {
  return set === null || set.has(ruleId);
}

/** Resolves whether a given rule is suppressed at a given line. */
export class Suppressions {
  private readonly byLine = new Map<number, RuleSet>();
  private readonly fileWide: RuleSet[] = [];
  private readonly ranges: { start: number; end: number; rules: RuleSet }[] = [];

  constructor(comments: readonly TSESTree.Comment[], totalLines: number) {
    let open: { start: number; rules: RuleSet } | null = null;

    for (const comment of comments) {
      const directive = parseDirective(comment);
      if (directive === null) continue;

      const rules: RuleSet = directive.rules.length === 0 ? null : new Set(directive.rules);

      switch (directive.kind) {
        case 'disable-file':
          this.fileWide.push(rules);
          break;

        case 'disable-next-line':
          this.addLine(directive.line + 1, rules);
          break;

        case 'disable-line':
          this.addLine(directive.line, rules);
          break;

        case 'disable':
          open ??= { start: directive.line, rules };
          break;

        case 'enable':
          if (open !== null) {
            this.ranges.push({ start: open.start, end: directive.line, rules: open.rules });
            open = null;
          }
          break;
      }
    }

    // An unclosed `anchor-disable` runs to the end of the file, matching how
    // every other linter behaves.
    if (open !== null) {
      this.ranges.push({ start: open.start, end: totalLines + 1, rules: open.rules });
    }
  }

  private addLine(line: number, rules: RuleSet): void {
    const existing = this.byLine.get(line);
    if (existing === null) return; // already suppressing everything
    if (rules === null || existing === undefined) {
      this.byLine.set(line, rules);
      return;
    }
    for (const rule of rules) existing.add(rule);
  }

  isSuppressed(ruleId: string, line: number): boolean {
    if (this.fileWide.some((rules) => matches(rules, ruleId))) return true;

    const lineRules = this.byLine.get(line);
    if (lineRules !== undefined && matches(lineRules, ruleId)) return true;

    return this.ranges.some(
      (range) => line >= range.start && line <= range.end && matches(range.rules, ruleId),
    );
  }
}
