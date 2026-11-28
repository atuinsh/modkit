import {
  textOf,
  UiTree,
  type ButtonNode,
  type CommandView,
  type UiNode,
} from '@atuin/modkit-target/host'

import type { NodeJson, PaneJson, ViewJson } from '../contract.ts'

export interface OpenPane {
  id: string
  title: string
  body: readonly UiNode[]
}

/** Serialized opencode {@link ViewJson} paired with its interactive {@link ButtonNode} lookup table. */
export class OpencodeView {
  readonly #json: ViewJson
  readonly #buttons: ReadonlyMap<string, ButtonNode>

  private constructor({
    json,
    buttons,
  }: {
    json: ViewJson
    buttons: ReadonlyMap<string, ButtonNode>
  }) {
    this.#json = json
    this.#buttons = buttons
  }

  /** Empty view rendered before a session mounts. */
  static readonly EMPTY: OpencodeView = new OpencodeView({
    json: { statuses: [], panes: [], commands: [] },
    buttons: new Map(),
  })

  /** Serialize rendered statuses, open panes, and commands into an {@link OpencodeView}. */
  static render({
    statuses,
    open,
    commands,
  }: {
    statuses: readonly (readonly UiNode[])[]
    open: readonly OpenPane[]
    commands: readonly Pick<CommandView, 'name' | 'description'>[]
  }): OpencodeView {
    const buttons = new Map<string, ButtonNode>()
    const json: ViewJson = {
      statuses: statuses.map((status, index) =>
        OpencodeView.#nodesJson(status, { at: `status${index}`, buttons }),
      ),
      panes: open.map((pane): PaneJson => ({
        id: pane.id,
        title: pane.title,
        body: OpencodeView.#nodesJson(pane.body, { at: `pane-${pane.id}`, buttons }),
      })),
      commands: commands.map(({ name, description }) => ({ name, description })),
    }
    return new OpencodeView({ json, buttons })
  }

  get json(): ViewJson {
    return this.#json
  }

  button(id: string): ButtonNode | undefined {
    return this.#buttons.get(id)
  }

  static #nodesJson(
    nodes: readonly UiNode[],
    walk: { at: string; buttons: Map<string, ButtonNode> },
  ): NodeJson[] {
    return nodes.map((node, index) =>
      OpencodeView.#nodeJson({ node, here: `${walk.at}.${index}`, walk }),
    )
  }

  static #nodeJson({
    node,
    here,
    walk,
  }: {
    node: UiNode
    here: string
    walk: { at: string; buttons: Map<string, ButtonNode> }
  }): NodeJson {
    const children = (nodes: readonly UiNode[]): NodeJson[] =>
      OpencodeView.#nodesJson(nodes, { ...walk, at: here })
    return UiTree.visit<NodeJson>(node, {
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
      button: (button) => OpencodeView.#buttonJson({ node: button, here, walk }),
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

  static #buttonJson({
    node,
    here,
    walk: { at, buttons },
  }: {
    node: ButtonNode
    here: string
    walk: { at: string; buttons: Map<string, ButtonNode> }
  }): NodeJson {
    const name = UiTree.buttonKey(node, here)
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
}
