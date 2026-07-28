import { Button } from './components/button';
import { Card } from './components/card';
import { cn } from './lib/utils';

/**
 * Everything here follows the design system. `anchor lint` reports nothing.
 */
export function PricingPanel({ featured }: { featured: boolean }) {
  return (
    <Card className={cn('flex flex-col gap-4', featured && 'shadow-card')}>
      <h2 className="text-lg text-foreground">Team</h2>
      <h3 className="text-muted-foreground">Everything you need to ship</h3>

      <p className="text-muted-foreground">Billed annually.</p>

      <Button variant="primary" size="lg">
        Choose Team
      </Button>
    </Card>
  );
}
