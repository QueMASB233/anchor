import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens. These are what components should reach for.
        background: '#ffffff',
        foreground: '#0f172a',
        muted: '#f1f5f9',
        'muted-foreground': '#64748b',
        primary: '#2563eb',
        'primary-foreground': '#f8fafc',
        destructive: '#dc2626',
        border: '#e2e8f0',
      },
      borderRadius: {
        card: '0.75rem',
      },
      boxShadow: {
        card: '0 1px 3px rgb(0 0 0 / 0.1), 0 1px 2px rgb(0 0 0 / 0.06)',
      },
    },
  },
} satisfies Config;
