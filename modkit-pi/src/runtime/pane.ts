import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type KeyId,
} from '@earendil-works/pi-tui'

import { collectButtons, type ButtonNode, type UiNode } from '@atuin/modkit-target/host'

import { linesOf, PICK_MARK, type Paint } from './lines.ts'

export const FOCUS_KEY = 'alt+m'

const MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'super'])
const SPECIAL_KEYS = new Set([
  'escape',
  'esc',
  'enter',
  'return',
  'tab',
  'space',
  'backspace',
  'delete',
  'insert',
  'clear',
  'home',
  'end',
  'pageUp',
  'pageDown',
  'up',
  'down',
  'left',
  'right',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])
const BASE_CHAR = /^[a-z0-9`\-=[\]\\;',./!@#$%^&*()_+|~{}:"<>?]$/u

function isKeyId(raw: string): raw is KeyId {
  const parts = raw.split('+')
  const base = parts.at(-1)
  if (base === undefined || (!BASE_CHAR.test(base) && !SPECIAL_KEYS.has(base))) return false
  const mods = parts.slice(0, -1)
  return new Set(mods).size === mods.length && mods.every((mod) => MODIFIERS.has(mod))
}

export interface PaneState {
  title: string
  body: readonly UiNode[]
}

function hintOf({
  isFocused,
  canScroll,
  hasButtons,
}: {
  isFocused: boolean
  canScroll: boolean
  hasButtons: boolean
}): string {
  if (!isFocused) return ` ${FOCUS_KEY} to use `
  const keys = [
    ...(canScroll ? ['↑↓ scroll'] : []),
    ...(hasButtons ? ['tab/enter buttons'] : []),
    'esc close',
    `${FOCUS_KEY} prompt`,
  ]
  return ` ${keys.join(' · ')} `
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

// The scroll that brings the picked button's line into view, or `scroll` when it shows already.
function revealing({
  scroll,
  body,
  room,
}: {
  scroll: number
  body: readonly string[]
  room: number
}): number {
  const at = body.findIndex((line) => line.includes(PICK_MARK))
  if (at === -1 || (at >= scroll && at < scroll + room)) return scroll
  return at < scroll ? at : at - room + 1
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
  isRevealing = false,
  paint,
}: {
  pane: PaneState
  isFocused: boolean
  width: number
  height?: number | undefined
  scroll?: number
  isRevealing?: boolean
  paint: (hasKeys: boolean) => Paint
}): DrawnPane {
  if (width < FRAME_COLUMNS) return { lines: [], scroll: 0, room: 0 }
  const inner = width - FRAME_COLUMNS
  const look = paint(isFocused)
  const body = linesOf({ nodes: pane.body, width: inner, paint: look })
  const room = height === undefined ? body.length : Math.max(1, height - FRAME_ROWS)
  const from = Math.max(
    0,
    Math.min(isRevealing ? revealing({ scroll, body, room }) : scroll, body.length - room),
  )
  const hasButtons = collectButtons(pane.body).length > 0
  const hint = hintOf({ isFocused, canScroll: body.length > room, hasButtons })
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

const PICKS: readonly { key: KeyId; by: number }[] = [
  { key: 'tab', by: 1 },
  { key: 'shift+tab', by: -1 },
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
  #picked: number | undefined = undefined
  // True from a move of the keyboard to the render that scrolls its button into view.
  #isRevealing = false

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
      isRevealing: this.#isRevealing,
      paint: (hasKeys) => ({
        ...this.#paint(hasKeys),
        ...(hasKeys && { picked: this.#pickedButton() }),
      }),
    })
    this.#scroll = drawn.scroll
    this.#isRevealing = false
    this.#room = drawn.room
    return drawn.lines
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.#close()
      return
    }
    const button = matchesKey(data, 'enter') ? this.#pickedButton() : this.#hotkeyed(data)
    if (button !== undefined) {
      this.#press(button)
      return
    }
    if (this.#scrolled(data) || this.#moved(data)) this.#redraw()
  }

  #pickedButton(): ButtonNode | undefined {
    return this.#picked === undefined ? undefined : collectButtons(this.#pane.body)[this.#picked]
  }

  #hotkeyed(data: string): ButtonNode | undefined {
    return collectButtons(this.#pane.body).find(
      ({ hotkey }) => hotkey !== undefined && isKeyId(hotkey) && matchesKey(data, hotkey),
    )
  }

  #scrolled(data: string): boolean {
    const scroll = SCROLLS.find(({ key }) => matchesKey(data, key))
    if (scroll === undefined) return false
    // Held past either end at the next render, which knows how tall the body is.
    this.#scroll = Math.max(0, this.#scroll + scroll.by(this.#room))
    return true
  }

  // Tab moves the keyboard to the next of the pane's buttons, and shift+tab to the one before.
  #moved(data: string): boolean {
    const step = PICKS.find(({ key }) => matchesKey(data, key))?.by
    const count = collectButtons(this.#pane.body).length
    if (step === undefined || count === 0) return false
    const from = this.#picked ?? (step > 0 ? -1 : 0)
    this.#picked = (from + step + count) % count
    this.#isRevealing = true
    return true
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- pi's Component asks for it
  invalidate(): void {
    // Drawn afresh from the pane's state on every render, so there's nothing cached to drop.
  }
}
