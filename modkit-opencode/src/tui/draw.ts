import type { Border, Hex, Tone } from '@atuin/modkit-target/host'

import type { NodeJson, ViewJson } from '../contract'

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

function fgOf(style: Style): Paint {
  if (style.color !== undefined) return { hex: style.color }
  if (style.tone !== 'plain') return { tone: style.tone }
  // A link draws in the accent buttons do, unless its text is colored.
  return style.href === undefined ? { tone: 'plain' } : { tone: 'accent' }
}

const spanOf = ({ text, style }: { text: string; style: Style }): Span => ({
  text,
  fg: fgOf(style),
  bold: style.bold,
  ...(style.background !== undefined && { bg: { hex: style.background } }),
  ...(style.href !== undefined && { href: style.href }),
})

function plainOf(node: NodeJson): string {
  if (typeof node === 'string') return node
  switch (node.kind) {
    case 'Text':
    case 'Link':
    case 'Column':
    case 'Row':
      return node.children.map((child) => plainOf(child)).join('')
    case 'Button':
      return node.label
    case 'Img':
      return node.fallback
    case 'Markdown':
      break
  }
  return node.text
}

type Inline = Extract<NodeJson, { kind: 'Text' | 'Link' }>

const isInline = (node: NodeJson): node is Inline =>
  typeof node !== 'string' && (node.kind === 'Text' || node.kind === 'Link')

// The style `node`'s children are drawn in, inside `around`.
function styleIn({ node, around }: { node: Inline; around: Style }): Style {
  if (node.kind === 'Link') return { ...around, href: node.href }
  return {
    tone: node.tone === 'plain' ? around.tone : node.tone,
    bold: node.bold || around.bold,
    color: node.color ?? around.color,
    background: node.background ?? around.background,
    href: around.href,
  }
}

function spansOf({
  node,
  around,
  spellsUrls,
}: {
  node: NodeJson
  around: Style
  spellsUrls: boolean
}): Span[] {
  if (!isInline(node)) {
    const text = plainOf(node)
    return text === '' ? [] : [spanOf({ text, style: around })]
  }
  const style = styleIn({ node, around })
  const spans = node.children.flatMap((child) =>
    spansOf({ node: child, around: style, spellsUrls }),
  )
  if (node.kind === 'Text' || !spellsUrls || plainOf(node) === node.href) return spans
  const url = { ...around, tone: 'dim' as const, color: undefined }
  return [...spans, spanOf({ text: ` (${node.href})`, style: url })]
}

const buttonSpans = ({
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

// The box a `Column` or `Row` draws `children` in.
function boxSpec({
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

/**
 * Specs drawing `nodes`, with the hotkeys beside buttons when `hasKeys`, and each link's URL after
 * its text when `spellsUrls`, for a terminal that opens no links.
 */
export function specsOf({
  nodes,
  hasKeys,
  spellsUrls,
}: {
  nodes: readonly NodeJson[]
  hasKeys: boolean
  spellsUrls: boolean
}): Spec[] {
  return nodes.map((node): Spec => {
    if (typeof node === 'string') {
      return { tag: 'text', spans: [spanOf({ text: node, style: PLAIN })] }
    }
    switch (node.kind) {
      case 'Text':
      case 'Link':
        return { tag: 'text', spans: spansOf({ node, around: PLAIN, spellsUrls }) }
      case 'Column':
      case 'Row':
        return boxSpec({ node, children: specsOf({ nodes: node.children, hasKeys, spellsUrls }) })
      case 'Button':
        return {
          tag: 'text',
          spans: buttonSpans({ label: node.label, hotkey: node.hotkey, hasKeys }),
        }
      case 'Img': {
        const { png, columns, rows, fallback } = node
        return { tag: 'image', png, columns, rows, fallback }
      }
      case 'Markdown':
        break
    }
    return { tag: 'markdown', content: node.text }
  })
}

export function hotkeysIn(nodes: readonly NodeJson[]): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (node: NodeJson): void => {
    if (typeof node === 'string' || node.kind === 'Markdown' || node.kind === 'Img') return
    if (node.kind === 'Button') {
      if (node.hotkey !== undefined && !found.has(node.hotkey)) found.set(node.hotkey, node.id)
      return
    }
    for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return found
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const EMPTY_VIEW: ViewJson = { statuses: [], panes: [], commands: [] }

export function viewOf(answer: unknown): ViewJson {
  if (!isRecord(answer)) return EMPTY_VIEW
  const { statuses, panes, commands } = answer
  if (!Array.isArray(statuses) || !Array.isArray(panes) || !Array.isArray(commands)) {
    return EMPTY_VIEW
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/consistent-type-assertions -- the server part's own `ViewJson`, over the RPC
  return answer as unknown as ViewJson
}
