import type { CommandView } from '@atuin/modkit/host'

import type { PaneId } from './pane-id.ts'

export type Awaitable<T> = T | Promise<T>

/** A pane of the mod's, as a target's harness opens it. */
export interface PaneOpening {
  id: PaneId
  title: string
  /** Whether the pane takes the keyboard: true when an interaction of the person's opened it. */
  focus: boolean
}

/** Whether a target's harness placed a pane it was asked to open, or why it waits. */
export type PaneOpened = { isPlaced: true } | { isPlaced: false; reason: string }

/** Pane surface operations implemented by harnesses that display panes. */
export interface PaneHost<Engine> {
  readonly open: (engine: Engine, pane: PaneOpening) => Awaitable<PaneOpened>
  readonly close: (engine: Engine, id: PaneId) => Awaitable<unknown>
  readonly isShown: (engine: Engine, id: PaneId) => Awaitable<boolean>
}

/** Command registration surface implemented by harnesses with slash commands. */
export interface CommandHost<Engine> {
  readonly register: (engine: Engine, command: CommandView) => Awaitable<unknown>
}

/** Redraw surface implemented by harnesses with push-based views. */
export interface ViewHost<Engine> {
  readonly redraw: (engine: Engine) => Awaitable<unknown>
}

const NOOP = (): void => undefined
const NEVER_SHOWN = (): boolean => false

/** No-op {@link PaneHost} for harnesses that draw no panes. */
export class NopPaneHost<Engine> implements PaneHost<Engine> {
  readonly #reason: string

  constructor(reason = 'this harness draws no panes') {
    this.#reason = reason
  }

  readonly open: PaneHost<Engine>['open'] = () => ({ isPlaced: false, reason: this.#reason })
  readonly close: PaneHost<Engine>['close'] = NOOP
  readonly isShown: PaneHost<Engine>['isShown'] = NEVER_SHOWN
}

/** No-op {@link CommandHost} for harnesses that do not register mod commands. */
export const NOP_COMMAND_HOST: CommandHost<unknown> = { register: NOOP }

/** No-op {@link ViewHost} for pull-based or headless harnesses. */
export const NOP_VIEW_HOST: ViewHost<unknown> = { redraw: NOOP }
