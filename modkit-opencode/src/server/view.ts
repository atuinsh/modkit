import {
  buttonKey,
  textOf,
  visitUiNode,
  type ButtonNode,
  type CommandView,
  type UiNode,
} from '@atuin/modkit-target/host'

import type { NodeJson, PaneJson, ViewJson } from '../contract.ts'

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
  const name = buttonKey(node, here)
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
  const children = (nodes: readonly UiNode[]): NodeJson[] => nodesJson(nodes, { ...walk, at: here })
  return visitUiNode<NodeJson>(node, {
    string: (text) => text,
    text: (textNode) => ({
      kind: 'Text',
      tone: textNode.tone,
      bold: textNode.bold,
      ...(textNode.color !== undefined && { color: textNode.color }),
      ...(textNode.background !== undefined && { background: textNode.background }),
      children: children(textNode.children),
    }),
    link: (linkNode) => ({
      kind: 'Link',
      href: linkNode.href,
      children: children(linkNode.children),
    }),
    stack: (stack) => ({
      kind: stack.kind,
      gap: stack.gap,
      ...(stack.border !== undefined && { border: stack.border }),
      ...(stack.borderTone !== undefined && { borderTone: stack.borderTone }),
      ...(stack.paddingX !== undefined && { paddingX: stack.paddingX }),
      ...(stack.paddingY !== undefined && { paddingY: stack.paddingY }),
      children: children(stack.children),
    }),
    button: (button) => buttonJson({ node: button, here, walk }),
    img: ({ png, columns, rows, fallback }) => ({
      kind: 'Img',
      png: png.base64,
      columns,
      rows,
      fallback,
    }),
    markdown: (md) => ({ kind: 'Markdown', text: md.text }),
  })
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
