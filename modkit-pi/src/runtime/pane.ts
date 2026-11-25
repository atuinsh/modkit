import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type KeyId,
} from '@earendil-works/pi-tui'

import type { ButtonNode, UiNode } from '@atuin/modkit-target/host'

import { linesOf, type Paint } from './lines'

export const FOCUS_KEY = 'alt+m'

function hotkeysIn(nodes: readonly UiNode[]): Map<string, ButtonNode> {
  const found = new Map<string, ButtonNode>()
  const walk = (node: UiNode): void => {
    if (typeof node === 'string' || node.kind === 'Markdown') return
    if (node.kind === 'Button' && node.hotkey !== undefined && !found.has(node.hotkey)) {
      found.set(node.hotkey, node)
    }
    if (node.kind !== 'Button') for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return found
}

export interface PaneState {
  title: string
  body: readonly UiNode[]
}

function hintOf({ isFocused, canScroll }: { isFocused: boolean; canScroll: boolean }): string {
  if (!isFocused) return ` ${FOCUS_KEY} to use `
  return canScroll
    ? ` ↑↓ scroll · esc close · ${FOCUS_KEY} prompt `
    : ` esc close · ${FOCUS_KEY} prompt `
}

// A pane's frame: a side and a space each way across, and an edge above and below.
const FRAME_COLUMNS = 4
const FRAME_ROWS = 2
const CORNER_COLUMNS = 3

// `text` cut to fit an edge `width` wide, with the edge's line run before or after it.
function edged({
  text,
  width,
  end,
  isAfter,
}: {
  text: string
  width: number
  end: string
  isAfter: boolean
}): string {
  const kept = truncateToWidth(text, Math.max(0, width - FRAME_COLUMNS), end)
  const run = '─'.repeat(Math.max(0, width - CORNER_COLUMNS - visibleWidth(kept)))
  return isAfter ? `${kept}${run}` : `${run}${kept}`
}

interface DrawnPane {
  lines: string[]
  scroll: number
  room: number
}

function paneLines({
  pane,
  isFocused,
  width,
  height,
  scroll = 0,
  paint,
}: {
  pane: PaneState
  isFocused: boolean
  width: number
  height?: number | undefined
  scroll?: number
  paint: (hasKeys: boolean) => Paint
}): DrawnPane {
  if (width < FRAME_COLUMNS) return { lines: [], scroll: 0, room: 0 }
  const inner = width - FRAME_COLUMNS
  const look = paint(isFocused)
  const body = linesOf({ nodes: pane.body, width: inner, paint: look })
  const room = height === undefined ? body.length : Math.max(1, height - FRAME_ROWS)
  const from = Math.max(0, Math.min(scroll, body.length - room))
  const hint = hintOf({ isFocused, canScroll: body.length > room })
  const top = `╭─${edged({ text: ` ${pane.title} `, width, end: '…', isAfter: true })}╮`
  const bottom = `╰${edged({ text: hint, width, end: '', isAfter: false })}─╯`
  const tone = isFocused ? 'success' : undefined
  const side = look.border({ tone, text: '│' })
  const shown = body
    .slice(from, from + room)
    .map((line) => `${side} ${line}${' '.repeat(Math.max(0, inner - visibleWidth(line)))} ${side}`)
  const lines = [look.border({ tone, text: top }), ...shown, look.border({ tone, text: bottom })]
  return { lines, scroll: from, room }
}

const SCROLLS: readonly { key: KeyId; by: (room: number) => number }[] = [
  { key: 'up', by: () => -1 },
  { key: 'down', by: () => 1 },
  { key: 'pageUp', by: (room) => -room },
  { key: 'pageDown', by: (room) => room },
]

export class PaneComponent implements Component {
  readonly #pane: PaneState
  readonly #isFocused: () => boolean
  readonly #height: () => number | undefined
  readonly #paint: (hasKeys: boolean) => Paint
  readonly #press: (button: ButtonNode) => void
  readonly #close: () => void
  readonly #redraw: () => void
  #scroll = 0
  #room = 0

  constructor({
    pane,
    isFocused,
    height,
    paint,
    press,
    close,
    redraw,
  }: {
    pane: PaneState
    isFocused: () => boolean
    height: () => number | undefined
    paint: (hasKeys: boolean) => Paint
    press: (button: ButtonNode) => void
    close: () => void
    redraw: () => void
  }) {
    this.#pane = pane
    this.#isFocused = isFocused
    this.#height = height
    this.#paint = paint
    this.#press = press
    this.#close = close
    this.#redraw = redraw
  }

  render(width: number): string[] {
    const drawn = paneLines({
      pane: this.#pane,
      isFocused: this.#isFocused(),
      width,
      height: this.#height(),
      scroll: this.#scroll,
      paint: this.#paint,
    })
    this.#scroll = drawn.scroll
    this.#room = drawn.room
    return drawn.lines
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.#close()
      return
    }
    const scroll = SCROLLS.find(({ key }) => matchesKey(data, key))
    if (scroll !== undefined) {
      // Held past either end at the next render, which knows how tall the body is.
      this.#scroll = Math.max(0, this.#scroll + scroll.by(this.#room))
      this.#redraw()
      return
    }
    for (const [hotkey, button] of hotkeysIn(this.#pane.body)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/consistent-type-assertions -- a mod's hotkey is a key as pi spells one
      if (matchesKey(data, hotkey as KeyId)) {
        this.#press(button)
        return
      }
    }
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- pi's Component asks for it
  invalidate(): void {
    // Drawn afresh from the pane's state on every render, so there's nothing cached to drop.
  }
}
