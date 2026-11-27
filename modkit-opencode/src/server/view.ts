import { textOf, type ButtonNode, type CommandView, type UiNode } from '@atuin/modkit-target/host'

import type { NodeJson, PaneJson, ViewJson } from '../contract'

interface Walk {
  at: string
  buttons: Map<string, ButtonNode>
}

function buttonJson({
  node,
  here,
  walk: { at, buttons },
}: {
  node: ButtonNode
  here: string
  walk: Walk
}): NodeJson {
  // A key or a hotkey names its button for good; a position moves as the list around it does.
  const name = node.key ?? (node.hotkey === undefined ? here : `hotkey:${node.hotkey}`)
  const named = `${at.split('.')[0] ?? at}:${name}`
  // Two buttons of one pane may share a key or a hotkey, as in separate lists; the later one is
  // told apart by where it is.
  const id = buttons.has(named) ? `${named}@${here}` : named
  buttons.set(id, node)
  return {
    kind: 'Button',
    id,
    label: textOf(node.children),
    ...(node.hotkey !== undefined && { hotkey: node.hotkey }),
  }
}

function nodeJson({ node, here, walk }: { node: UiNode; here: string; walk: Walk }): NodeJson {
  if (typeof node === 'string') return node
  const children = (): NodeJson[] =>
    'children' in node ? nodesJson(node.children, { ...walk, at: here }) : []
  switch (node.kind) {
    case 'Text':
      return {
        kind: 'Text',
        tone: node.tone,
        bold: node.bold,
        ...(node.color !== undefined && { color: node.color }),
        ...(node.background !== undefined && { background: node.background }),
        children: children(),
      }
    case 'Column':
    case 'Row':
      return {
        kind: node.kind,
        gap: node.gap,
        ...(node.border !== undefined && { border: node.border }),
        ...(node.borderTone !== undefined && { borderTone: node.borderTone }),
        ...(node.paddingX !== undefined && { paddingX: node.paddingX }),
        ...(node.paddingY !== undefined && { paddingY: node.paddingY }),
        children: children(),
      }
    case 'Button':
      return buttonJson({ node, here, walk })
    case 'Img': {
      const { png, columns, rows, fallback } = node
      return { kind: 'Img', png: png.base64, columns, rows, fallback }
    }
    case 'Markdown':
      break
  }
  return { kind: 'Markdown', text: node.text }
}

function nodesJson(nodes: readonly UiNode[], walk: Walk): NodeJson[] {
  return nodes.map((node, index) => nodeJson({ node, here: `${walk.at}.${index}`, walk }))
}

export interface OpenPane {
  id: string
  title: string
  body: readonly UiNode[]
}

export interface Drawn {
  json: ViewJson
  buttons: Map<string, ButtonNode>
}

export const NOTHING_DRAWN: Drawn = {
  json: { statuses: [], panes: [], commands: [] },
  buttons: new Map(),
}

export function viewJsonOf({
  statuses,
  open,
  commands,
}: {
  statuses: readonly (readonly UiNode[])[]
  open: readonly OpenPane[]
  commands: readonly Pick<CommandView, 'name' | 'description'>[]
}): Drawn {
  const buttons = new Map<string, ButtonNode>()
  return {
    json: {
      statuses: statuses.map((status, index) =>
        nodesJson(status, { at: `status${index}`, buttons }),
      ),
      panes: open.map((pane): PaneJson => ({
        id: pane.id,
        title: pane.title,
        body: nodesJson(pane.body, { at: `pane-${pane.id}`, buttons }),
      })),
      commands: commands.map(({ name, description }) => ({ name, description })),
    },
    buttons,
  }
}
