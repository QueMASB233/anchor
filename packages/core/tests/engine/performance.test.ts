import { describe, expect, it } from 'vitest';

import { lintFile } from '../../src/engine/linter.js';
import {
  createColorSystem,
  createDesignSystem,
  createShadowSystem,
  createSpacingScale,
} from '../../src/model/index.js';
import { ALL_RULES } from '../../src/rules/index.js';

/**
 * The spec's target is well under 10 seconds for a few hundred components in
 * CI. This measures the deterministic engine only — no I/O, no git — so it is
 * a floor rather than an end-to-end figure, but a regression here would be
 * felt directly by every user on every pull request.
 */
describe('performance', () => {
  const designSystem = createDesignSystem({
    meta: { name: 'Perf', source: 'tailwind' },
    tokens: {
      spacing: createSpacingScale(
        Array.from({ length: 35 }, (_unused, index) => ({
          name: String(index),
          value: `${index * 4}px`,
        })),
      ),
      color: createColorSystem(
        Array.from({ length: 250 }, (_unused, index) => ({
          name: `c-${index}`,
          value: `#${index.toString(16).padStart(6, '0')}`,
        })),
      ),
      shadow: createShadowSystem([{ name: 'card', value: '0 4px 6px rgba(0,0,0,0.1)' }]),
    },
    components: {
      Button: {
        name: 'Button',
        variants: { variant: ['primary', 'ghost'], size: ['sm', 'md'] },
        requiredProps: [],
        source: 'config',
      },
    },
    compositionRules: [
      { id: 'no-nested-card', parent: 'Card', forbiddenDescendants: ['Card'], severity: 'error' },
    ],
  });

  /** A component of roughly the size real ones are. */
  function component(index: number): string {
    return `
      import { cn } from '@/lib/utils';
      export function Component${index}({ dense }: { dense: boolean }) {
        return (
          <Card className={cn('flex gap-2 p-4 shadow-card', dense && 'p-[13px]')}>
            <h1 className="text-lg">Title ${index}</h1>
            <h2 className="text-base text-gray-500">Subtitle</h2>
            <Button variant="primary" size="md">Action</Button>
            <div className="bg-[#123456] rounded-md p-2" style={{ marginTop: '4px' }} />
            <ul className="flex gap-1">
              {[1, 2, 3].map((n) => (
                <li key={n} className="p-1">{n}</li>
              ))}
            </ul>
          </Card>
        );
      }
    `;
  }

  it('lints 300 components in well under the CI budget', () => {
    const files = Array.from({ length: 300 }, (_unused, index) => ({
      path: `src/components/Component${index}.tsx`,
      content: component(index),
    }));

    const started = performance.now();
    let total = 0;
    for (const file of files) {
      total += lintFile(file, designSystem, ALL_RULES).violations.length;
    }
    const elapsed = performance.now() - started;

    console.log(
      `lint 300 components: ${elapsed.toFixed(0)}ms (${(elapsed / files.length).toFixed(2)}ms/file), ${total} violations`,
    );

    expect(total).toBeGreaterThan(0);
    // Generous ceiling so the test is not flaky on a loaded CI runner; the
    // logged figure is what to watch.
    expect(elapsed).toBeLessThan(10_000);
  });
});
