import type { ModpartName } from '@atuin/modkit-compiler'

/** How a target provides one modpart. */
export type Support =
  /** As the mod wrote it. */
  | { readonly kind: 'native' }
  /** In a weaker form, which `why` names: `ask falls back to otherwise`. */
  | { readonly kind: 'lowered'; readonly why: string }
  /** Not at all, for the reason `why` gives: `Codex draws no panes`. */
  | { readonly kind: 'dropped'; readonly why: string }

/**
 * How a target provides each modpart.
 *
 * A target names every modpart, so a new one fails to compile in each target until it says how it
 * provides it.
 */
export type Capabilities = Readonly<Record<ModpartName, Support>>

/** The {@link Support} of a modpart a target provides as written. */
export const NATIVE: Support = { kind: 'native' }
