/**
 * Shared lookups for any token group whose values reduce to pixels.
 *
 * Spacing, border radius, font size and friends all need the same two
 * questions answered — "is this value on the scale?" and "what is nearest?" —
 * so the logic lives here once rather than drifting between token groups.
 */

/** The minimum a token must expose to take part in nearest-value lookups. */
export interface PxToken {
  name: string;
  px: number | null;
  deprecated?: boolean | undefined;
}

/**
 * Finds the token closest to `px`.
 *
 * Ties resolve to the smaller value so a suggested fix never enlarges a
 * measurement more than it has to. Deprecated tokens are excluded: suggesting
 * a token the team is actively retiring would be actively unhelpful.
 *
 * Returns `null` when no token has a resolvable pixel value.
 */
export function nearestPxToken<T extends PxToken>(tokens: readonly T[], px: number): T | null {
  let best: { token: T; distance: number; px: number } | null = null;

  for (const token of tokens) {
    if (token.px === null || token.deprecated === true) continue;

    const distance = Math.abs(token.px - px);
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && token.px < best.px)
    ) {
      best = { token, distance, px: token.px };
    }
  }

  return best?.token ?? null;
}

/** True when `px` exactly matches a non-deprecated token. */
export function isOnPxScale(tokens: readonly PxToken[], px: number): boolean {
  return tokens.some((token) => token.px === px && token.deprecated !== true);
}
