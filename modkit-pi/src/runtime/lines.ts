import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

import {
  textOf,
  UiTree,
  type Border,
  type ButtonNode,
  type ImgNode,
  type LinkNode,
  type StyledSpan,
  type TextNode,
  type Tone,
  type UiNode,
} from '@atuin/modkit-target/host'

// Drawn before the button the keyboard is on.
export const PICK_MARK = '›'

export interface Paint {
  text: (span: StyledSpan) => string
  border: (border: { tone: Tone | undefined; text: string }) => string
  button: (button: { label: string; hotkey: string | undefined; isPicked: boolean }) => string
  // The button the keyboard is on, which enter presses.
  picked?: ButtonNode | undefined
  // Whether a link's text is followed by its URL: where the terminal opens no links, and the
  // nodes are drawn with room for it.
  spellsUrls: boolean
  markdown: (markdown: { text: string; width: number }) => readonly string[]
  // A picture's lines, or undefined where the surface or the terminal draws none.
  image: (image: { node: ImgNode; width: number }) => readonly string[] | undefined
}

const EDGES: Readonly<Record<Border, readonly [string, string, string, string, string, string]>> = {
  single: ['┌', '┐', '┘', '└', '─', '│'],
  round: ['╭', '╮', '╯', '╰', '─', '│'],
  double: ['╔', '╗', '╝', '╚', '═', '║'],
  bold: ['┏', '┓', '┛', '┗', '━', '┃'],
  dashed: ['┌', '┐', '┘', '└', '╌', '╎'],
}

// A box has a left side and a right one.
const SIDES = 2

const padded = ({ line, width }: { line: string; width: number }): string =>
  line + ' '.repeat(Math.max(0, width - visibleWidth(line)))

const widest = (lines: readonly string[]): number =>
  Math.max(0, ...lines.map((line) => visibleWidth(line)))

function wrapped({ text, width }: { text: string; width: number }): string[] {
  return text.split('\n').flatMap((line) => wrapTextWithAnsi(line, width))
}

interface Placed {
  lines: string[]
  width: number
}

// The children placed on one line of a row, side by side.
function besideLines({ placed, gap }: { placed: readonly Placed[]; gap: number }): string[] {
  const height = Math.max(0, ...placed.map((one) => one.lines.length))
  return Array.from({ length: height }, (_unused, row) =>
    placed
      .map((one, index) => {
        const line = one.lines[row] ?? ''
        return index === placed.length - 1 ? line : padded({ line, width: one.width })
      })
      .join(' '.repeat(gap))
      .trimEnd(),
  )
}

/** Terminal line layout renderer for modkit {@link UiNode} trees on pi-tui. */
export class PiLineRenderer {
  readonly #paint: Paint

  constructor(paint: Paint) {
    this.#paint = paint
  }

  /** Render `nodes` wrapped to `width` columns. */
  render(nodes: readonly UiNode[], width: number): string[] {
    if (width < 1) return []
    return nodes.flatMap((node) => this.#nodeLines(node, width))
  }

  #textLines(node: TextNode | LinkNode, width: number): string[] {
    const spans = UiTree.flattenSpans(node, { spellsUrls: this.#paint.spellsUrls })
    // Styled a line at a time, so a span across a newline is styled on both its lines.
    const lines = spans.map((span) =>
      span.text.split('\n').map((text) => this.#paint.text({ ...span, text })),
    )
    const joined = ['']
    for (const [first = '', ...rest] of lines) {
      joined.push((joined.pop() ?? '') + first, ...rest)
    }
    return joined.flatMap((line) => wrapTextWithAnsi(line, width))
  }

  #rowLines({
    children,
    width,
    gap,
  }: {
    children: readonly UiNode[]
    width: number
    gap: number
  }): string[] {
    const rows: Placed[][] = [[]]
    let left = width
    for (const child of children) {
      // A child with no room left beside the ones before it starts the row's next line.
      if (left <= 0) {
        rows.push([])
        left = width
      }
      const lines = this.render([child], left)
      const drawn = widest(lines)
      rows.at(-1)?.push({ lines, width: drawn })
      left -= drawn + gap
    }
    return rows.flatMap((placed) => besideLines({ placed, gap }))
  }

  #boxed({
    node,
    width,
    body,
  }: {
    node: { border?: Border; borderTone?: Tone; paddingX?: number; paddingY?: number }
    width: number
    body: (width: number) => string[]
  }): string[] {
    const padX = node.paddingX ?? 0
    const padY = node.paddingY ?? 0
    const edge = node.border === undefined ? 0 : 1
    const inner = width - SIDES * (edge + padX)
    // Too narrow for its border and padding: the stack is drawn without them.
    if (inner < 1) return body(width)
    const blank = Array.from({ length: padY }, () => '')
    const lines = [...blank, ...body(inner), ...blank].map(
      (line) => ' '.repeat(padX) + padded({ line, width: inner }) + ' '.repeat(padX),
    )
    if (node.border === undefined) return lines.map((line) => line.trimEnd())
    const [topLeft, topRight, bottomRight, bottomLeft, across, down] = EDGES[node.border]
    const tone = node.borderTone
    const side = this.#paint.border({ tone, text: down })
    const run = across.repeat(width - SIDES)
    return [
      this.#paint.border({ tone, text: `${topLeft}${run}${topRight}` }),
      ...lines.map((line) => `${side}${line}${side}`),
      this.#paint.border({ tone, text: `${bottomLeft}${run}${bottomRight}` }),
    ]
  }

  #nodeLines(node: UiNode, width: number): string[] {
    const paint = this.#paint
    return UiTree.visit(node, {
      string: (text) => wrapped({ text, width }),
      text: (textNode) => this.#textLines(textNode, width),
      link: (linkNode) => this.#textLines(linkNode, width),
      stack: (stack) =>
        this.#boxed({
          node: stack,
          width,
          body: (inner) =>
            stack.kind === 'Column'
              ? stack.children.flatMap((child, index) => [
                  ...(index === 0 ? [] : Array.from({ length: stack.gap }, () => '')),
                  ...this.render([child], inner),
                ])
              : this.#rowLines({ children: stack.children, width: inner, gap: stack.gap }),
        }),
      button: (button) =>
        wrapped({
          text: paint.button({
            label: textOf(button.children),
            hotkey: button.hotkey,
            isPicked: button === paint.picked,
          }),
          width,
        }),
      img: (img) => {
        const picture = paint.image({ node: img, width })
        return picture === undefined ? wrapped({ text: img.fallback, width }) : [...picture]
      },
      markdown: (md) => [...paint.markdown({ text: md.text, width })],
    })
  }
}
