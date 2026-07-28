import { Button } from './components/button';
import { Card } from './components/card';
import { cn } from './lib/utils';

/**
 * The same panel as `on-system.tsx`, written the way a coding agent tends to
 * write it before it has read CLAUDE.md. Run `anchor lint` to see each problem
 * named, located, and paired with the token that should have been used.
 */
export function PricingPanel({ featured }: { featured: boolean }) {
  return (
    <Card className={cn('flex flex-col gap-[18px]', featured && 'p-[13px]')}>
      <h2 className="text-[#0f172a]">Team</h2>

      {/* Skips h3, which removes a landmark screen reader users navigate by. */}
      <h4 className="text-slate-500">Everything you need to ship</h4>

      <p style={{ marginTop: '6px', color: '#64748b' }}>Billed annually.</p>

      <Card>Nested cards double the padding, border and elevation.</Card>

      <div className="shadow-[0_2px_9px_rgba(0,0,0,0.13)]">
        <Button variant="primry" size="lg">
          Choose Team
        </Button>
      </div>
    </Card>
  );
}
