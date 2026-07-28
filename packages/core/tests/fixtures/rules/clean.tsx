/**
 * A component that respects the design system in every way the eight rules
 * check. Linting this file must produce exactly zero violations.
 */
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva('inline-flex rounded-md p-2', {
  variants: {
    variant: { primary: 'bg-brand', secondary: 'bg-surface', ghost: 'bg-transparent' },
    size: { sm: 'p-1 text-sm', md: 'p-2', lg: 'p-4 text-lg' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export function Panel({ dense, title }: { dense: boolean; title: string }) {
  return (
    <Card className={cn('flex gap-2 p-4 shadow-card', dense && 'p-1', { 'gap-1': dense })}>
      <h1 className="text-lg text-secondary">{title}</h1>
      <h2 className="text-base">Details</h2>
      <h3 className="text-sm">Fine print</h3>

      <Button variant="primary" size="md">
        Confirm
      </Button>

      <List>
        <ListItem>One</ListItem>
        <ListItem>Two</ListItem>
      </List>

      {/* A CSS custom property is the sanctioned way to pass a runtime value. */}
      <div style={{ '--progress': `${50}%` }} className="w-full rounded-md" />
    </Card>
  );
}
