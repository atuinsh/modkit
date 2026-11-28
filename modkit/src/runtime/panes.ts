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

/**
 * Harness UI operation produced by {@link PaneReconciler.reconcile}.
 *
 * Emitting `open` for an already-open pane ID updates its title.
 */
export type PaneChange = { kind: 'open'; id: string; title: string } | { kind: 'close'; id: string }

type Rendered = readonly Pick<PaneView, 'id' | 'title'>[]

/** Stateful reconciler tracking open and user-dismissed top-level panes across renders. */
export class PaneReconciler {
  #open = new Map<string, string>()
  #dismissed = new Set<string>()

  /**
   * Reconcile the current pane state against the latest `rendered` top-level panes.
   *
   * Returns ordered {@link PaneChange} operations (closes before opens), emitting `open` for newly
   * rendered panes and open panes whose title changed.
   */
  reconcile(rendered: Rendered): PaneChange[] {
    const held = rendered.filter((pane) => !this.#dismissed.has(pane.id))
    const opens = held.flatMap((pane): PaneChange[] =>
      this.#open.get(pane.id) === pane.title ? [] : [{ kind: 'open', ...pane }],
    )
    const ids = new Set(rendered.map((pane) => pane.id))
    const closes = this.#open
      .keys()
      .filter((id) => !ids.has(id))
      .map((id): PaneChange => ({ kind: 'close', id }))
      .toArray()
    this.#open = new Map(held.map((pane) => [pane.id, pane.title]))
    this.#dismissed = this.#dismissed.intersection(ids)
    return [...closes, ...opens]
  }

  /**
   * Record that the user closed pane `id`, suppressing reopens while rendered.
   * Returns `true` if `id` was currently open.
   */
  dismiss(id: string): boolean {
    if (!this.#open.has(id)) return false
    this.#open.delete(id)
    this.#dismissed.add(id)
    return true
  }

  /** Clear all tracked open and dismissed pane state. */
  reset(): void {
    this.#open.clear()
    this.#dismissed.clear()
  }
}
