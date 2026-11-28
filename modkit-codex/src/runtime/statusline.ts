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

const KEPT_SPACE = '\u00A0'
const encoder = new TextEncoder()

function preserveSpaces(text: string): string | undefined {
  if (text === '') return undefined
  return text.replaceAll(/^ +| +$| {2,}/gu, (spaces) => KEPT_SPACE.repeat(spaces.length))
}

function fitBytes({ text, bytes }: { text: string; bytes: number }): string {
  if (encoder.encode(text).length <= bytes) return text
  let kept = ''
  for (const character of text) {
    if (encoder.encode(kept + character).length > bytes) break
    kept += character
  }
  return kept
}

/** Renders modkit status {@link UiNode} rows into Codex's bounded status line tree. */
export class CodexStatusLine {
  #nodes = MAX_NODES
  #bytes = MAX_TEXT_BYTES

  /** Render status rows into Codex's JSON status line tree, or `null` when empty. */
  static render(statuses: readonly (readonly UiNode[])[]): LineRow | null {
    const renderer = new CodexStatusLine()
    const parts = statuses.flatMap((status) => {
      const children = renderer.#renderNodes(status)
      return children.length === 0 ? [] : [{ type: 'row' as const, props: { gap: 0 }, children }]
    })
    if (parts.length === 0) return null
    const kept = renderer.#clip({ type: 'row', props: { gap: 1 }, children: parts })
    return kept === undefined || typeof kept === 'string' || kept.type !== 'row' ? null : kept
  }

  #renderNodes(nodes: readonly UiNode[]): LineElement[] {
    return nodes.flatMap((node) => {
      const element = this.#renderNode(node)
      return element === undefined ? [] : [element]
    })
  }

  #renderText(node: TextNode): LineElement {
    const color = node.color ?? TONE_COLORS[node.tone]
    const props = {
      ...(color !== undefined && { color }),
      ...(node.bold && { weight: 'bold' as const }),
    }
    const text: LineText = {
      type: 'text',
      ...(Object.keys(props).length > 0 && { props }),
      children: this.#renderNodes(node.children),
    }
    if (node.background === undefined) return text
    return { type: 'row', props: { gap: 0, background: node.background }, children: [text] }
  }

  #renderNode(node: UiNode): LineElement | undefined {
    if (typeof node === 'string') return preserveSpaces(node)
    switch (node.kind) {
      case 'Text':
        return this.#renderText(node)
      case 'Row':
      case 'Column':
        return { type: 'row', props: { gap: node.gap }, children: this.#renderNodes(node.children) }
      // Nothing in Codex's status line can be pressed or opened, so each draws as its text.
      case 'Button':
      case 'Link':
        return { type: 'text', children: this.#renderNodes(node.children) }
      case 'Img':
        return preserveSpaces(node.fallback)
      case 'Markdown':
        break
    }
    return preserveSpaces(node.text)
  }

  #clip(element: LineElement, depth = 0): LineElement | undefined {
    if (this.#nodes === 0 || depth > MAX_DEPTH) return undefined
    if (typeof element === 'string') {
      const text = fitBytes({ text: element, bytes: this.#bytes })
      if (text === '') return undefined
      this.#nodes -= 1
      this.#bytes -= encoder.encode(text).length
      return text
    }
    this.#nodes -= 1
    const children = element.children.flatMap((child) => {
      const kept = this.#clip(child, depth + 1)
      return kept === undefined ? [] : [kept]
    })
    return { ...element, children }
  }
}
