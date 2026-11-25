import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

import {
  textOf,
  type Border,
  type ButtonNode,
  type Hex,
  type TextNode,
  type Tone,
  type UiNode,
} from '@atuin/modkit-target/host'

// Drawn before the button the keyboard is on.
export const PICK_MARK = '›'

export interface Paint {
  text: (span: Span) => string
  border: (border: { tone: Tone | undefined; text: string }) => string
  button: (button: { label: string; hotkey: string | undefined; isPicked: boolean }) => string
  // The button the keyboard is on, which enter presses.
  picked?: ButtonNode | undefined
  markdown: (markdown: { text: string; width: number }) => readonly string[]
}

interface Span {
  text: string
  tone: Tone
  bold: boolean
  color: Hex | undefined
  background: Hex | undefined
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

const NO_STYLE: Omit<Span, 'text'> = {
  tone: 'plain',
  bold: false,
  color: undefined,
  background: undefined,
}

const padded = ({ line, width }: { line: string; width: number }): string =>
  line + ' '.repeat(Math.max(0, width - visibleWidth(line)))

const widest = (lines: readonly string[]): number =>
  Math.max(0, ...lines.map((line) => visibleWidth(line)))

function spansOf({ node, around }: { node: TextNode; around: Omit<Span, 'text'> }): Span[] {
  const style = {
    tone: node.tone === 'plain' ? around.tone : node.tone,
    bold: node.bold || around.bold,
    color: node.color ?? around.color,
    background: node.background ?? around.background,
  }
  return node.children.flatMap((child): Span[] => {
    if (typeof child !== 'string' && child.kind === 'Text') {
      return spansOf({ node: child, around: style })
    }
    const text = textOf([child])
    return text === '' ? [] : [{ ...style, text }]
  })
}

function wrapped({ text, width }: { text: string; width: number }): string[] {
  return text.split('\n').flatMap((line) => wrapTextWithAnsi(line, width))
}

function textLines({
  node,
  width,
  paint,
}: {
  node: TextNode
  width: number
  paint: Paint
}): string[] {
  const spans = spansOf({ node, around: NO_STYLE })
  // Styled a line at a time, so a span across a newline is styled on both its lines.
  const lines = spans.map((span) =>
    span.text.split('\n').map((text) => paint.text({ ...span, text })),
  )
  const joined = ['']
  for (const [first = '', ...rest] of lines) {
    joined.push((joined.pop() ?? '') + first, ...rest)
  }
  return joined.flatMap((line) => wrapTextWithAnsi(line, width))
}

function rowLines({
  children,
  width,
  gap,
  paint,
}: {
  children: readonly UiNode[]
  width: number
  gap: number
  paint: Paint
}): string[] {
  const placed: { lines: string[]; width: number }[] = []
  let left = width
  for (const child of children) {
    if (left <= 0) break
    const lines = linesOf({ nodes: [child], width: left, paint })
    const drawn = widest(lines)
    placed.push({ lines, width: drawn })
    left -= drawn + gap
  }
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

function boxed({
  node,
  width,
  paint,
  body,
}: {
  node: { border?: Border; borderTone?: Tone; paddingX?: number; paddingY?: number }
  width: number
  paint: Paint
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
  const side = paint.border({ tone, text: down })
  const run = across.repeat(width - SIDES)
  return [
    paint.border({ tone, text: `${topLeft}${run}${topRight}` }),
    ...lines.map((line) => `${side}${line}${side}`),
    paint.border({ tone, text: `${bottomLeft}${run}${bottomRight}` }),
  ]
}

function nodeLines({
  node,
  width,
  paint,
}: {
  node: UiNode
  width: number
  paint: Paint
}): string[] {
  if (typeof node === 'string') return wrapped({ text: node, width })
  switch (node.kind) {
    case 'Text':
      return textLines({ node, width, paint })
    case 'Column':
      return boxed({
        node,
        width,
        paint,
        body: (inner) =>
          node.children.flatMap((child, index) => [
            ...(index === 0 ? [] : Array.from({ length: node.gap }, () => '')),
            ...linesOf({ nodes: [child], width: inner, paint }),
          ]),
      })
    case 'Row':
      return boxed({
        node,
        width,
        paint,
        body: (inner) => rowLines({ children: node.children, width: inner, gap: node.gap, paint }),
      })
    case 'Button': {
      const label = textOf(node.children)
      return wrapped({
        text: paint.button({ label, hotkey: node.hotkey, isPicked: node === paint.picked }),
        width,
      })
    }
    case 'Markdown':
      break
  }
  return [...paint.markdown({ text: node.text, width })]
}

export function linesOf({
  nodes,
  width,
  paint,
}: {
  nodes: readonly UiNode[]
  width: number
  paint: Paint
}): string[] {
  if (width < 1) return []
  return nodes.flatMap((node) => nodeLines({ node, width, paint }))
}
