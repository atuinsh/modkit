import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { OverlayHandle, OverlayOptions, TUI } from '@earendil-works/pi-tui'

import type { ButtonNode, Failure, UiNode } from '@atuin/modkit-target/host'

import { paintOf } from './paint'
import { PaneComponent, type PaneState } from './pane'

const PANE_WIDTH = '42%'
const PANE_MIN_COLUMNS = 40
const PANE_MARGIN = 1
const PANE_MIN_ROWS = 10

interface OpenPane {
  readonly state: PaneState
  handle: OverlayHandle | undefined
  close: (() => void) | undefined
  readonly hid: OpenPane[]
}

export interface Opening {
  ctx: ExtensionContext
  id: string
  title: string
  body: readonly UiNode[]
  focus: boolean
}

interface Drawn {
  opening: Opening
  pane: OpenPane
  tui: TUI
  theme: Theme
  done: () => void
}

export class Overlays {
  readonly #press: (pressed: { ctx: ExtensionContext; button: ButtonNode }) => void
  readonly #dismiss: (id: string) => void
  readonly #report: (failure: Failure) => void
  readonly #panes = new Map<string, OpenPane>()
  #tui: TUI | undefined = undefined

  constructor({
    press,
    dismiss,
    report,
  }: {
    press: (pressed: { ctx: ExtensionContext; button: ButtonNode }) => void
    dismiss: (id: string) => void
    report: (failure: Failure) => void
  }) {
    this.#press = press
    this.#dismiss = dismiss
    this.#report = report
  }

  has(id: string): boolean {
    return this.#panes.has(id)
  }

  show(opening: Opening): void {
    const open = this.#panes.get(opening.id)
    if (open === undefined) void this.#open(opening)
    else open.state.title = opening.title
  }

  forget(id: string): void {
    this.#unregister(id)?.close?.()
  }

  redraw(bodyOf: (id: string) => readonly UiNode[] | undefined): void {
    for (const [id, pane] of this.#panes) pane.state.body = bodyOf(id) ?? pane.state.body
    this.#tui?.requestRender()
  }

  toggleFocus(): void {
    const open = [...this.#panes.values()].flatMap((pane) =>
      pane.handle === undefined ? [] : [pane.handle],
    )
    const focused = open.find((handle) => handle.isFocused())
    if (focused === undefined) open.at(-1)?.focus()
    else focused.unfocus()
    this.#tui?.requestRender()
  }

  stop(): void {
    for (const pane of this.#panes.values()) pane.close?.()
    this.#panes.clear()
  }

  #layoutOf(id: string): { below: number; room: number | undefined } {
    let below = 0
    for (const [other, pane] of this.#panes) {
      if (other === id) break
      if (pane.handle?.isHidden() === true) continue
      below += pane.handle?.getBounds()?.height ?? 0
    }
    const rows = this.#tui?.terminal.rows
    return {
      below,
      room: rows === undefined ? undefined : rows - PANE_MARGIN - PANE_MARGIN - below,
    }
  }

  #placement({ id, focus }: { id: string; focus: boolean }): OverlayOptions {
    const { below, room } = this.#layoutOf(id)
    return {
      anchor: 'top-right',
      width: PANE_WIDTH,
      minWidth: PANE_MIN_COLUMNS,
      margin: PANE_MARGIN,
      offsetY: below,
      ...(room !== undefined && { maxHeight: Math.max(1, room) }),
      nonCapturing: !focus,
    }
  }

  #makeRoom({ id, pane }: { id: string; pane: OpenPane }): void {
    const { room } = this.#layoutOf(id)
    if (room === undefined || room >= PANE_MIN_ROWS) return
    for (const [other, earlier] of this.#panes) {
      if (other === id) break
      if (earlier.handle === undefined || earlier.handle.isHidden()) continue
      earlier.handle.setHidden(true)
      pane.hid.push(earlier)
    }
  }

  #unregister(id: string): OpenPane | undefined {
    const pane = this.#panes.get(id)
    if (pane === undefined) return undefined
    this.#panes.delete(id)
    // The panes this one hid stay hidden while the pane that hid it shows, which hides them in its
    // place.
    const hider = [...this.#panes.values()].find((other) => other.hid.includes(pane))
    if (hider === undefined) for (const hidden of pane.hid) hidden.handle?.setHidden(false)
    else hider.hid.push(...pane.hid)
    return pane
  }

  async #open(opening: Opening): Promise<void> {
    const { ctx, id, title, body, focus } = opening
    const pane: OpenPane = { state: { title, body }, handle: undefined, close: undefined, hid: [] }
    this.#panes.set(id, pane)
    this.#makeRoom({ id, pane })
    try {
      await ctx.ui.custom<null>(
        // oxlint-disable-next-line eslint/max-params -- pi calls an overlay's factory with these four
        (tui, theme, _keys, done) =>
          this.#component({
            opening,
            pane,
            tui,
            theme,
            done: () => {
              done(null)
            },
          }),
        {
          overlay: true,
          overlayOptions: () => this.#placement({ id, focus }),
          onHandle: (handle) => {
            pane.handle = handle
          },
        },
      )
    } catch (error) {
      this.#report({ phase: 'render', error })
    }
    if (this.#panes.get(id) === pane) this.#unregister(id)
  }

  #component({ opening, pane, tui, theme, done }: Drawn): PaneComponent {
    const { ctx, id } = opening
    this.#tui = tui
    // oxlint-disable-next-line eslint/no-param-reassign -- the pane is this overlay's record, closed through pi's `done`
    pane.close = done
    return new PaneComponent({
      pane: pane.state,
      isFocused: () => pane.handle?.isFocused() === true,
      height: () => this.#layoutOf(id).room,
      paint: (hasKeys) => paintOf({ theme, hasKeys }),
      press: (button) => {
        this.#press({ ctx, button })
      },
      close: () => {
        this.forget(id)
        this.#dismiss(id)
      },
      redraw: () => {
        tui.requestRender()
      },
    })
  }
}
