/**
 * Pointer-capability probes for touch-primary (phone/tablet) frames.
 *
 * Guarded on purpose: a host without `matchMedia` (jsdom, older WebViews,
 * non-DOM runtimes) reports "not touch-primary", so pointer-gated behavior
 * degrades to the desktop path instead of throwing during render or in an
 * effect. Call sites must go through these helpers rather than calling
 * `window.matchMedia` directly.
 */

/**
 * Whether the primary pointer cannot hover — a touch phone or tablet.
 * @returns true when `(hover: none)` matches in this host.
 */
export function isTouchPrimary(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: none)').matches
}
