/**
 * Figma names variables with slashes; Anchor converts them to the dashed names
 * code actually consumes, converts 0-1 RGBA floats back to hex, and follows
 * VARIABLE_ALIAS references.
 *
 * The export in this directory is the raw response from Figma's "Get local
 * variables" endpoint. Nothing has been reshaped by hand.
 */
export function Banner() {
  return (
    <aside className="p-spacing-md">
      <h2 className="text-color-text-default">Storage almost full</h2>

      {/* 12px sits between spacing-sm (8px) and spacing-md (16px). */}
      <p className="mt-[12px]">Upgrade to keep syncing.</p>

      {/* The brand blue, written out by hand. */}
      <button className="bg-[#2563EB]">Upgrade</button>
    </aside>
  );
}
