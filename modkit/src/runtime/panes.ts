/**
 * Reconciliation state machine for top-level panes.
 *
 * A top-level pane stays open while rendered. If the user dismisses it, the pane stays closed
 * across subsequent renders that still include it -- preventing a mod that ignores `onClose` from
 * reopening the pane behind the user's back. Once a render omits the pane, its dismissal is
 * cleared so rendering it again reopens it.
 *
 * @module
 */

import type { PaneView } from './render.ts'

/** Current top-level pane state tracked by a harness target. */
export interface Shown {
  /** Currently open panes, mapping pane ID to its last rendered title. */
  open: ReadonlyMap<string, string>
  /** Pane IDs closed by the user that are still present in the mod's rendered output. */
  dismissed: ReadonlySet<string>
}

/** Empty initial {@link Shown} state with no open or dismissed panes. */
export const NOTHING_SHOWN: Shown = { open: new Map(), dismissed: new Set() }

/**
 * Harness UI operation produced by {@link nextShown}.
 *
 * Emitting `open` for an already-open pane ID updates its title.
 */
export type PaneChange = { kind: 'open'; id: string; title: string } | { kind: 'close'; id: string }

type Rendered = readonly Pick<PaneView, 'id' | 'title'>[]

/**
 * Reconcile the currently `shown` panes against the latest `rendered` top-level panes.
 *
 * Returns the next {@link Shown} state and ordered {@link PaneChange} operations (closes before
 * opens). Emits an `open` change for newly rendered panes and for open panes whose title changed.
 */
export function nextShown({ shown, rendered }: { shown: Shown; rendered: Rendered }): {
  shown: Shown
  changes: PaneChange[]
} {
  const held = rendered.filter((pane) => !shown.dismissed.has(pane.id))
  const opens = held.flatMap((pane): PaneChange[] =>
    shown.open.get(pane.id) === pane.title ? [] : [{ kind: 'open', ...pane }],
  )
  const ids = new Set(rendered.map((pane) => pane.id))
  const closes = shown.open
    .keys()
    .filter((id) => !ids.has(id))
    .map((id): PaneChange => ({ kind: 'close', id }))
    .toArray()
  return {
    shown: {
      open: new Map(held.map((pane) => [pane.id, pane.title])),
      dismissed: shown.dismissed.intersection(ids),
    },
    changes: [...closes, ...opens],
  }
}

/**
 * Record that the user closed pane `id`, removing it from `open` and suppressing reopens while
 * rendered.
 */
export function dismissed({ shown, id }: { shown: Shown; id: string }): Shown {
  if (!shown.open.has(id)) return shown
  const open = new Map(shown.open)
  open.delete(id)
  return { open, dismissed: shown.dismissed.union(new Set([id])) }
}
