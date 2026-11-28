import type { ButtonNode } from './button.ts'
import type { ImgNode } from './img.ts'
import type { LinkNode } from './link.ts'
import type { MarkdownNode } from './markdown.ts'
import type { StackNode } from './stack.ts'
import type { TextNode } from './text.ts'

/** Resolved UI tree node produced by the renderer and consumed by harness targets. */
export type UiNode = string | TextNode | LinkNode | StackNode | ButtonNode | MarkdownNode | ImgNode

/** Every node in the trees `nodes` root, each before its children. */
export const nodesIn = (nodes: readonly UiNode[]): UiNode[] =>
  nodes.flatMap((node) =>
    typeof node === 'string' || node.kind === 'Markdown' || node.kind === 'Img'
      ? [node]
      : [node, ...nodesIn(node.children)],
  )
