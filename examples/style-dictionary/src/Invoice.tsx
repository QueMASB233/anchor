/**
 * Style Dictionary flattens nested groups into dashed token names, so
 * `color.text.muted` becomes `color-text-muted`. Aliases are followed: Anchor
 * knows `color-text-muted` resolves to the same colour as `color-base-slate-500`
 * and will point you at the semantic name rather than the palette entry.
 *
 * Run `anchor lint` here to see both violations below.
 */
export function Invoice() {
  return (
    <article className="p-md">
      <h1 className="text-color-text-primary">Invoice</h1>

      {/* Off the 4px scale: nearest is spacing-sm (8px). */}
      <p className="mt-[7px] text-color-text-muted">Due in 30 days.</p>

      {/* A palette value where a semantic token exists. */}
      <footer className="text-color-base-slate-500">Thanks for your business.</footer>
    </article>
  );
}
