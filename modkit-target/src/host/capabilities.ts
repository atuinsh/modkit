type ModpartName =
  | 'status'
  | 'commands'
  | 'panes'
  | 'beforeShell'
  | 'afterShell'
  | 'beforeTool'
  | 'afterTool'
  | 'toolCards'

/** A modpart provided as the mod wrote it. */
export interface NativeSupport {
  readonly kind: 'native'
}

/** A modpart provided in a weaker form described by `why`. */
export interface LoweredSupport {
  readonly kind: 'lowered'
  readonly why: string
}

/** A modpart omitted by the harness for the reason `why` gives. */
export interface DroppedSupport {
  readonly kind: 'dropped'
  readonly why: string
}

/** How a target provides one modpart. */
export type Support = NativeSupport | LoweredSupport | DroppedSupport

/**
 * How a target provides each modpart.
 *
 * A target names every modpart, so a new one fails to compile in each target until it says how it
 * provides it.
 */
export type Capabilities = Readonly<Record<ModpartName, Support>>

/** The {@link NativeSupport} of a modpart a target provides as written. */
export const NATIVE: NativeSupport = { kind: 'native' }
