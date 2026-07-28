import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

// Anchor reads these variants statically. No inventory has to be written by
// hand: `<Button variant="primry">` is caught because this file says so.
export const buttonVariants = cva('inline-flex items-center rounded-card font-medium', {
  variants: {
    variant: {
      primary: 'bg-primary text-primary-foreground',
      secondary: 'bg-muted text-foreground',
      ghost: 'bg-transparent text-foreground',
      destructive: 'bg-destructive text-primary-foreground',
    },
    size: {
      sm: 'h-8 px-2 text-sm',
      md: 'h-10 px-4',
      lg: 'h-12 px-6 text-lg',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
