import type { Hex, Tone } from '@atuin/modkit'
import {
  textOf,
  type ButtonNode,
  type ImgNode,
  type LinkNode,
  type MarkdownNode,
  type StackNode,
  type TextNode,
  type UiNode,
} from '@atuin/modkit/host'

/** Resolved inline text span after cascading nested `<Text>` and `<Link>` styles. */
export interface StyledSpan {
  readonly text: string
  readonly tone: Tone
  readonly bold: boolean
  readonly color: Hex | undefined
  readonly background: Hex | undefined
  readonly href: string | undefined
}

type TextStyle = Omit<StyledSpan, 'text'>

const PLAIN_STYLE: TextStyle = {
  tone: 'plain',
  bold: false,
  color: undefined,
  background: undefined,
  href: undefined,
}

function styleIn({ node, around }: { node: TextNode | LinkNode; around: TextStyle }): TextStyle {
  if (node.kind === 'Link') return { ...around, href: node.href }
  return {
    tone: node.tone === 'plain' ? around.tone : node.tone,
    bold: node.bold || around.bold,
    color: node.color ?? around.color,
    background: node.background ?? around.background,
    href: around.href,
  }
}

// What a link whose URL is spelled out ends with: the URL, unless its text already is. The space
// before it stays out of the dim span so wrapping does not leave a dim space on its own line.
function spelledUrl({ node, around }: { node: LinkNode; around: TextStyle }): StyledSpan[] {
  if (textOf(node.children) === node.href) return []
  return [
    { ...around, text: ' ' },
    { ...around, tone: 'dim', color: undefined, text: `(${node.href})` },
  ]
}

function collectSpans({
  node,
  around,
  spellsUrls,
}: {
  node: TextNode | LinkNode
  around: TextStyle
  spellsUrls: boolean
}): StyledSpan[] {
  const style = styleIn({ node, around })
  const spans = node.children.flatMap((child): StyledSpan[] => {
    if (typeof child !== 'string' && (child.kind === 'Text' || child.kind === 'Link')) {
      return collectSpans({ node: child, around: style, spellsUrls })
    }
    const text = textOf([child])
    return text === '' ? [] : [{ ...style, text }]
  })
  if (node.kind === 'Text' || !spellsUrls) return spans
  return [...spans, ...spelledUrl({ node, around })]
}

/** Exhaustive visitor over every {@link UiNode} variant. */
export interface UiVisitor<Out> {
  readonly string: (text: string) => Out
  readonly text: (node: TextNode) => Out
  readonly link: (node: LinkNode) => Out
  readonly stack: (node: StackNode) => Out
  readonly button: (node: ButtonNode) => Out
  readonly img: (node: ImgNode) => Out
  readonly markdown: (node: MarkdownNode) => Out
}

/** Bound traversal, text flattening, and identity operations over {@link UiNode} trees. */
export class UiTree {
  readonly #nodes: readonly UiNode[]

  private constructor(nodes: readonly UiNode[]) {
    this.#nodes = nodes
  }

  /** Wrap a slice of {@link UiNode}s for bound traversal operations. */
  static of(nodes: readonly UiNode[]): UiTree {
    return new UiTree(nodes)
  }

  /** Dispatch `node` exhaustively to `visitor`, forcing compile errors when a new node kind lands. */
  static visit<Out>(node: UiNode, visitor: UiVisitor<Out>): Out {
    if (typeof node === 'string') return visitor.string(node)
    switch (node.kind) {
      case 'Text':
        return visitor.text(node)
      case 'Link':
        return visitor.link(node)
      case 'Column':
      case 'Row':
        return visitor.stack(node)
      case 'Button':
        return visitor.button(node)
      case 'Img':
        return visitor.img(node)
      case 'Markdown':
        break
    }
    return visitor.markdown(node)
  }

  /** Flatten a {@link TextNode} or {@link LinkNode} into leaf {@link StyledSpan}s with cascaded styles. */
  static flattenSpans(
    node: TextNode | LinkNode,
    { spellsUrls = false }: { readonly spellsUrls?: boolean } = {},
  ): readonly StyledSpan[] {
    return collectSpans({ node, around: PLAIN_STYLE, spellsUrls })
  }

  /** Stable identity key for a {@link ButtonNode}, preferring explicit key, then hotkey, then path. */
  static buttonKey(node: ButtonNode, fallbackPath: string): string {
    return node.key ?? (node.hotkey === undefined ? fallbackPath : `hotkey:${node.hotkey}`)
  }

  /** Flatten all nodes in this tree into plain text. */
  text(): string {
    return textOf(this.#nodes)
  }

  /** Collect every {@link ButtonNode} in this tree in document order via {@link UiTree.visit}. */
  buttons(): readonly ButtonNode[] {
    return this.#nodes.flatMap((node): readonly ButtonNode[] =>
      UiTree.visit<readonly ButtonNode[]>(node, {
        string: () => [],
        text: (textNode) => UiTree.of(textNode.children).buttons(),
        link: (linkNode) => UiTree.of(linkNode.children).buttons(),
        stack: (stack) => UiTree.of(stack.children).buttons(),
        button: (button) => [button],
        img: () => [],
        markdown: () => [],
      }),
    )
  }
}
