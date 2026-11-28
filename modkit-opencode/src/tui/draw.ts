import type { Border, Hex, Tone } from '@atuin/modkit-target/host'

import { parseRunOutput, parseViewJson, type NodeJson, type ViewJson } from '../contract.ts'

export { EMPTY_VIEW, parseRunOutput } from '../contract.ts'

export type Paint = { tone: Tone | 'accent' | 'border' } | { hex: Hex }

export interface Span {
  text: string
  // Never left to opentui, whose default is white in every theme.
  fg: Paint
  bg?: Paint
  bold: boolean
  /** The URL the span opens, drawn underlined as part of a link. */
  href?: string
}

export type BorderStyle = 'single' | 'rounded' | 'double' | 'heavy'

export type Spec =
  | { tag: 'text'; spans: Span[] }
  | {
      tag: 'box'
      flexDirection: 'column' | 'row'
      gap: number
      border?: { style: BorderStyle; color: Paint }
      padding: { left: number; right: number; top: number; bottom: number }
      children: Spec[]
    }
  | { tag: 'markdown'; content: string }
  | { tag: 'image'; png: string; columns: number; rows: number; fallback: string }

const BORDER_STYLES: Readonly<Record<Border, BorderStyle>> = {
  single: 'single',
  round: 'rounded',
  double: 'double',
  bold: 'heavy',
  dashed: 'single',
}

interface Style {
  tone: Tone
  bold: boolean
  color: Hex | undefined
  background: Hex | undefined
  href: string | undefined
}

const PLAIN: Style = {
  tone: 'plain',
  bold: false,
  color: undefined,
  background: undefined,
  href: undefined,
}

type Inline = Extract<NodeJson, { kind: 'Text' | 'Link' }>

const isInline = (node: NodeJson): node is Inline =>
  typeof node !== 'string' && (node.kind === 'Text' || node.kind === 'Link')

function resolveForeground(style: Style): Paint {
  if (style.color !== undefined) return { hex: style.color }
  if (style.tone !== 'plain') return { tone: style.tone }
  // A link draws in the accent buttons do, unless its text is colored.
  return style.href === undefined ? { tone: 'plain' } : { tone: 'accent' }
}

const buildSpan = ({ text, style }: { text: string; style: Style }): Span => ({
  text,
  fg: resolveForeground(style),
  bold: style.bold,
  ...(style.background !== undefined && { bg: { hex: style.background } }),
  ...(style.href !== undefined && { href: style.href }),
})

function plainText(node: NodeJson): string {
  if (typeof node === 'string') return node
  switch (node.kind) {
    case 'Text':
    case 'Link':
    case 'Column':
    case 'Row':
      return node.children.map((child) => plainText(child)).join('')
    case 'Button':
      return node.label
    case 'Img':
      return node.fallback
    case 'Markdown':
      break
  }
  return node.text
}

function cascadeStyle({ node, around }: { node: Inline; around: Style }): Style {
  if (node.kind === 'Link') return { ...around, href: node.href }
  return {
    tone: node.tone === 'plain' ? around.tone : node.tone,
    bold: node.bold || around.bold,
    color: node.color ?? around.color,
    background: node.background ?? around.background,
    href: around.href,
  }
}

const buildButtonSpans = ({
  label,
  hotkey,
  hasKeys,
}: {
  label: string
  hotkey: string | undefined
  hasKeys: boolean
}): Span[] => [
  ...(hasKeys && hotkey !== undefined
    ? [{ text: `${hotkey} `, fg: { tone: 'accent' as const }, bold: true }]
    : []),
  { text: label, fg: { tone: 'accent' }, bold: false },
]

function buildBoxSpec({
  node,
  children,
}: {
  node: Extract<NodeJson, { kind: 'Column' | 'Row' }>
  children: Spec[]
}): Spec {
  const padX = node.paddingX ?? 0
  const padY = node.paddingY ?? 0
  return {
    tag: 'box',
    flexDirection: node.kind === 'Column' ? 'column' : 'row',
    gap: node.gap,
    ...(node.border !== undefined && {
      border: {
        style: BORDER_STYLES[node.border],
        color:
          node.borderTone === undefined || node.borderTone === 'plain'
            ? { tone: 'border' }
            : { tone: node.borderTone },
      },
    }),
    padding: { left: padX, right: padX, top: padY, bottom: padY },
    children,
  }
}

/** Translates serialized {@link NodeJson} trees into OpenTUI {@link Spec}s and hotkey maps. */
export class OpenTuiView {
  readonly #hasKeys: boolean
  readonly #spellsUrls: boolean

  private constructor({ hasKeys, spellsUrls }: { hasKeys: boolean; spellsUrls: boolean }) {
    this.#hasKeys = hasKeys
    this.#spellsUrls = spellsUrls
  }

  /** Parse an RPC `view` payload into a validated {@link ViewJson}. */
  static parse(answer: unknown): ViewJson {
    return parseViewJson(answer)
  }

  /** Parse an RPC `run` reply text. */
  static parseRunReply(answer: unknown): string {
    return parseRunOutput(answer)
  }

  /** Render `nodes` into OpenTUI specs. */
  static render({
    nodes,
    hasKeys,
    spellsUrls,
  }: {
    nodes: readonly NodeJson[]
    hasKeys: boolean
    spellsUrls: boolean
  }): Spec[] {
    return new OpenTuiView({ hasKeys, spellsUrls }).#renderNodes(nodes)
  }

  /** Collect every button hotkey in `nodes` (first occurrence wins) via exhaustive traversal. */
  static hotkeys(nodes: readonly NodeJson[]): Map<string, string> {
    const found = new Map<string, string>()
    const walk = (node: NodeJson): void => {
      if (typeof node === 'string') return
      switch (node.kind) {
        case 'Markdown':
        case 'Img':
          return
        case 'Button':
          if (node.hotkey !== undefined && !found.has(node.hotkey)) found.set(node.hotkey, node.id)
          return
        case 'Text':
        case 'Link':
        case 'Column':
        case 'Row':
          for (const child of node.children) walk(child)
      }
    }
    for (const node of nodes) walk(node)
    return found
  }

  #renderNodes(nodes: readonly NodeJson[]): Spec[] {
    return nodes.map((node) => this.#renderNode(node))
  }

  #renderNode(node: NodeJson): Spec {
    if (typeof node === 'string') {
      return { tag: 'text', spans: [buildSpan({ text: node, style: PLAIN })] }
    }
    switch (node.kind) {
      case 'Text':
      case 'Link':
        return { tag: 'text', spans: this.#collectSpans(node, PLAIN) }
      case 'Column':
      case 'Row':
        return buildBoxSpec({ node, children: this.#renderNodes(node.children) })
      case 'Button':
        return {
          tag: 'text',
          spans: buildButtonSpans({
            label: node.label,
            hotkey: node.hotkey,
            hasKeys: this.#hasKeys,
          }),
        }
      case 'Img': {
        const { png, columns, rows, fallback } = node
        return { tag: 'image', png, columns, rows, fallback }
      }
      case 'Markdown':
        break
    }
    return { tag: 'markdown', content: node.text }
  }

  #collectSpans(node: NodeJson, around: Style): Span[] {
    if (!isInline(node)) {
      const text = plainText(node)
      return text === '' ? [] : [buildSpan({ text, style: around })]
    }
    const style = cascadeStyle({ node, around })
    const spans = node.children.flatMap((child) => this.#collectSpans(child, style))
    if (node.kind === 'Text' || !this.#spellsUrls || plainText(node) === node.href) return spans
    const url = { ...around, tone: 'dim' as const, color: undefined }
    return [...spans, buildSpan({ text: ` (${node.href})`, style: url })]
  }
}
