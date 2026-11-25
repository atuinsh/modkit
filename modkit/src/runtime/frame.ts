import type { Harness, Store, Stored } from '../harness/types'
import type { Press } from '../ui/button'
import type { Query } from '../ui/hooks/query'
import type { Callback } from './schema'

export interface QueryRegistration {
  query: Query<unknown, unknown>
  key: string | undefined
  input: unknown
}

/** Runtime services supplied to components and hooks during a single render pass. */
export interface RenderScope {
  readonly harness: Harness
  readonly store: Store
  /** Persist `stored` under `key` and trigger a re-render. */
  write: (change: { key: string; stored: Stored }) => void
  /** Wrap a button `onPress` so thrown errors are reported to the adapter instead of thrown. */
  action: (onPress: Callback) => (press: Press) => Promise<void>
  query: (registration: QueryRegistration) => void
  refresh: (id: string) => Promise<void>
}

/** Active component execution frame exposed to hooks via {@link activeFrame}. */
export interface Frame {
  readonly scope: RenderScope
  readonly component: string
}

const frames: Frame[] = []

/** Run `fn` with `frame` pushed onto the active render stack, popping it on exit. */
export function withFrame<T>(frame: Frame, fn: () => T): T {
  frames.push(frame)
  try {
    return fn()
  } finally {
    frames.pop()
  }
}

/**
 * Return the innermost active render {@link Frame}.
 *
 * @throws {Error} If called outside of a component render (`hook` names the caller in the error).
 */
export function activeFrame(hook: string): Frame {
  const frame = frames.at(-1)
  if (frame === undefined) throw new Error(`${hook} runs only while a component renders`)
  return frame
}

/** Return `true` while a component render is on the call stack. */
export const isRendering = (): boolean => frames.length > 0
