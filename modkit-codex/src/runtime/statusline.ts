import type { TextNode, Tone, UiNode } from '@atuin/modkit-target/host'

type LineColor = 'red' | 'green' | 'yellow' | 'status-metadata' | `#${string}`

interface LineText {
  type: 'text'
  props?: { color?: LineColor; weight?: 'bold' }
  children: LineElement[]
}

export interface LineRow {
  type: 'row'
  props: { gap: number; background?: `#${string}` }
  children: LineElement[]
}

type LineElement = string | LineText | LineRow

const MAX_NODES = 256
const MAX_DEPTH = 15
const MAX_TEXT_BYTES = 16_384

const TONE_COLORS: Readonly<Record<Tone, LineColor | undefined>> = {
  plain: undefined,
  dim: 'status-metadata',
  warning: 'yellow',
  success: 'green',
  error: 'red',
}

const KEPT_SPACE = ' '

const keptSpaces = (text: string): string =>
  text.replaceAll(/^ +| +$| {2,}/gu, (spaces) => KEPT_SPACE.repeat(spaces.length))

const leafOf = (text: string): string | undefined => (text === '' ? undefined : keptSpaces(text))

function elementsOf(nodes: readonly UiNode[]): LineElement[] {
  return nodes.flatMap((node) => {
    const element = elementOf(node)
    return element === undefined ? [] : [element]
  })
}

function textOf(node: TextNode): LineElement {
  const color = node.color ?? TONE_COLORS[node.tone]
  const props = {
    ...(color !== undefined && { color }),
    ...(node.bold && { weight: 'bold' as const }),
  }
  const text: LineText = {
    type: 'text',
    ...(Object.keys(props).length > 0 && { props }),
    children: elementsOf(node.children),
  }
  if (node.background === undefined) return text
  return { type: 'row', props: { gap: 0, background: node.background }, children: [text] }
}

function elementOf(node: UiNode): LineElement | undefined {
  if (typeof node === 'string') return leafOf(node)
  switch (node.kind) {
    case 'Text':
      return textOf(node)
    case 'Row':
    case 'Column':
      return { type: 'row', props: { gap: node.gap }, children: elementsOf(node.children) }
    // Nothing in Codex's status line can be pressed or opened, so each draws as its text.
    case 'Button':
    case 'Link':
      return { type: 'text', children: elementsOf(node.children) }
    case 'Img':
      return leafOf(node.fallback)
    case 'Markdown':
      break
  }
  return leafOf(node.text)
}

const encoder = new TextEncoder()

function fitted({ text, bytes }: { text: string; bytes: number }): string {
  if (encoder.encode(text).length <= bytes) return text
  let kept = ''
  for (const character of text) {
    if (encoder.encode(kept + character).length > bytes) break
    kept += character
  }
  return kept
}

// What Codex takes of a status line: so many nodes, so deep, holding so many bytes of text.
class Budget {
  #nodes = MAX_NODES
  #bytes = MAX_TEXT_BYTES

  cut(element: LineElement, depth = 0): LineElement | undefined {
    if (this.#nodes === 0 || depth > MAX_DEPTH) return undefined
    if (typeof element === 'string') {
      const text = fitted({ text: element, bytes: this.#bytes })
      if (text === '') return undefined
      this.#nodes -= 1
      this.#bytes -= encoder.encode(text).length
      return text
    }
    this.#nodes -= 1
    const children = element.children.flatMap((child) => {
      const kept = this.cut(child, depth + 1)
      return kept === undefined ? [] : [kept]
    })
    return { ...element, children }
  }
}

export function statusLineOf(statuses: readonly (readonly UiNode[])[]): LineRow | null {
  const parts = statuses.flatMap((status) => {
    const children = elementsOf(status)
    if (children.length === 0) return []
    return [{ type: 'row' as const, props: { gap: 0 }, children }]
  })
  if (parts.length === 0) return null
  const root: LineRow = { type: 'row', props: { gap: 1 }, children: parts }
  const kept = new Budget().cut(root)
  return kept === undefined || typeof kept === 'string' || kept.type !== 'row' ? null : kept
}
