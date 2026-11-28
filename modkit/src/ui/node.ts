import type { ButtonNode } from './button'
import type { LinkNode } from './link'
import type { MarkdownNode } from './markdown'
import type { StackNode } from './stack'
import type { TextNode } from './text'

/** Resolved UI tree node produced by the renderer and consumed by harness targets. */
export type UiNode = string | TextNode | LinkNode | StackNode | ButtonNode | MarkdownNode

/** Every node in the trees `nodes` root, each before its children. */
export const nodesIn = (nodes: readonly UiNode[]): UiNode[] =>
  nodes.flatMap((node) =>
    typeof node === 'string' || node.kind === 'Markdown'
      ? [node]
      : [node, ...nodesIn(node.children)],
  )
