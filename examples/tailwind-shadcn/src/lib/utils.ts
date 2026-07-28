import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The standard shadcn/ui helper. Anchor follows class strings through it. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
