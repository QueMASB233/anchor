/**
 * Every violation the eight rules are meant to catch, once each.
 * The expected set is asserted exactly, so a new false positive fails the test.
 */
import { cn } from '@/lib/utils';

export function Broken({ dense }: { dense: boolean }) {
  return (
    <Card className="p-[13px]">
      {/* 1. no-arbitrary-spacing: 13px is off the 4px scale */}
      {/* 2. no-raw-hex-colors: matches the `brand` token exactly */}
      <div className="bg-[#3b82f6]" />

      {/* 3. use-design-tokens: gray-500 has a semantic equivalent */}
      <span className="text-gray-500">Muted</span>

      {/* 4. no-inline-styles */}
      <div style={{ marginTop: '13px' }} />

      {/* 5. valid-component-variants: `primarry` is a typo */}
      <Button variant="primarry">Send</Button>

      {/* 6. composition-rules: Card must not contain Card */}
      <Card className="p-2">Nested</Card>

      {/* 7. no-custom-shadows */}
      <div className="shadow-[0_9px_31px_rgba(0,0,0,0.42)]" />

      {/* 8. heading-order: h1 then h3 */}
      <h1>Title</h1>
      <h3>Skipped a level</h3>

      <div className={cn('flex', dense && 'gap-[7px]')} />
    </Card>
  );
}
