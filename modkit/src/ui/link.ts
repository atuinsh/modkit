import * as v from 'valibot'

import { primitive, textOf, type Component, type ModNode } from '../runtime/element'
import { nodesIn, type UiNode } from './node'
import type { TextNode } from './text'

/** Resolved `Link` element. */
export interface LinkNode {
  kind: 'Link'
  href: string
  /** What the link says: strings and `Text` nodes, or `href` itself when the mod gave no text. */
  children: readonly UiNode[]
}

export interface LinkProps {
  /** Absolute URL the link opens, such as `https://atuin.sh`. */
  href: string
  /** What the link says. Defaults to `href`. */
  children?: ModNode
}

// The longest link Claude Code draws; held to on every harness, so a mod's links work on all.
const MAX_HREF_CHARS = 2048

const HrefSchema = v.pipe(
  v.string(),
  v.url('expected an absolute URL, such as https://atuin.sh'),
  // A raw control character would end the escape sequence a terminal draws a link with.
  v.regex(/^[^\s\p{Cc}]+$/u, 'expected no spaces or control characters; percent-encode them'),
  v.maxLength(MAX_HREF_CHARS),
)

const isNonText = (node: UiNode): node is Exclude<UiNode, string | TextNode> =>
  typeof node !== 'string' && node.kind !== 'Text'

/**
 * Hyperlink to `href`, opened by the terminal or the harness when clicked; may sit inside a `Text`.
 *
 * It holds strings and `Text` only. Where the harness or the terminal opens no links, it draws as
 * its text, followed in a pane by its URL.
 */
export const Link: Component<LinkProps> = primitive({
  name: 'Link',
  schema: v.object({ href: HrefSchema }),
  node: ({ props: { href }, children }) => {
    const held = nodesIn(children).find((node) => isNonText(node))
    if (held !== undefined) {
      throw new TypeError(`a <Link> holds text and <Text>, not a <${held.kind}>`)
    }
    return { kind: 'Link', href, children: textOf(children) === '' ? [href] : children }
  },
  text: ({ node }) => textOf(node.children),
})
