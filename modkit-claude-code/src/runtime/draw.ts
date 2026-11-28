/**
 * Translator from `@atuin/modkit` {@link UiNode} trees to Claude Code `h()` render nodes.
 *
 * Claude Code's `Text` element only accepts strings and inline elements (nested `Text`s and
 * `Link`s), so other children inside a `Text` or `Link` node are flattened via `textOf()`, while
 * bare strings and `Link`s outside a `Text` node are wrapped in one. Every emitted element receives
 * a deterministic key (`at.<index>`, or explicit `key` / `hotkey:<k>` on buttons).
 *
 * An `Img` is Claude Code's `Image` where the surface has one, the terminal's: Claude Code picks the
 * protocol, and draws the fallback as the `alt` where the terminal speaks none. Every other surface
 * refuses a tree holding an `Image`, so draws the fallback as text.
 *
 * @module
 */

import type { Elements, RenderNode } from 'claude-code'

import {
  buttonKey,
  textOf,
  visitUiNode,
  type ButtonNode,
  type ImgNode,
  type LinkNode,
  type StackNode,
  type TextNode,
  type Tone,
  type UiNode,
} from '@atuin/modkit-target/host'

function toneProps(tone: Tone): Readonly<Record<string, unknown>> {
  switch (tone) {
    case 'plain':
      return {}
    case 'dim':
      return { dimColor: true }
    case 'warning':
    case 'success':
    case 'error':
      break
  }
  return { color: tone }
}

function borderToneProps(tone: Tone | undefined): Readonly<Record<string, unknown>> {
  switch (tone) {
    case undefined:
    case 'plain':
      return {}
    case 'dim':
      return { borderDimColor: true }
    case 'warning':
    case 'success':
    case 'error':
      break
  }
  return { borderColor: tone }
}

const boxProps = (node: StackNode): Readonly<Record<string, unknown>> => ({
  flexDirection: node.kind === 'Column' ? 'column' : 'row',
  gap: node.gap,
  ...(node.border !== undefined && {
    borderStyle: node.border,
    ...borderToneProps(node.borderTone),
  }),
  ...(node.paddingX !== undefined && { paddingX: node.paddingX }),
  ...(node.paddingY !== undefined && { paddingY: node.paddingY }),
})

/**
 * Drawing modkit {@link UiNode} trees with the elements one Claude Code surface resolves, and
 * pressing their buttons through `press`, which runs on that surface's `$`.
 */
export class Drawing {
  readonly #elements: Elements
  readonly #press: (button: ButtonNode) => void

  constructor({ elements, press }: { elements: Elements; press: (button: ButtonNode) => void }) {
    this.#elements = elements
    this.#press = press
  }

  /** Draw `nodes`, keying each by its position under `at`. */
  nodes(nodes: readonly UiNode[], at = 'n'): RenderNode[] {
    const elements = this.#elements
    return nodes.map((node, index): RenderNode => {
      const key = `${at}.${index}`
      return visitUiNode(node, {
        string: (text) => h(elements.Text, { key }, text),
        text: (textNode) => this.#text(textNode, key),
        link: (linkNode) => h(elements.Text, { key }, this.#link(linkNode, `${key}.0`)),
        stack: (stack) =>
          h(elements.Box, { key, ...boxProps(stack) }, ...this.nodes(stack.children, key)),
        button: (button) => this.#button(button, key),
        img: (img) => this.#image(img, key),
        markdown: (md) => h(elements.Markdown, { key, text: md.text }),
      })
    })
  }

  // What a `Text` or a `Link` holds: strings, and `Text`s and `Link`s as elements of their own.
  #inline(nodes: readonly UiNode[], key: string): RenderNode[] {
    return nodes.map((node, index) => {
      if (typeof node === 'string') return node
      switch (node.kind) {
        case 'Text':
          return this.#text(node, `${key}.${index}`)
        case 'Link':
          return this.#link(node, `${key}.${index}`)
        case 'Column':
        case 'Row':
        case 'Button':
        case 'Img':
        case 'Markdown':
          break
      }
      return textOf([node])
    })
  }

  #link(node: LinkNode, key: string): RenderNode {
    return h(this.#elements.Link, { key, href: node.href }, ...this.#inline(node.children, key))
  }

  #text(node: TextNode, key: string): RenderNode {
    const children = this.#inline(node.children, key)
    const props = {
      key,
      ...toneProps(node.tone),
      ...(node.color !== undefined && { color: node.color }),
      ...(node.background !== undefined && { backgroundColor: node.background }),
      ...(node.bold && { weight: 'bold' }),
    }
    return h(this.#elements.Text, props, ...children)
  }

  #image(node: ImgNode, key: string): RenderNode {
    const { Image, Text } = this.#elements
    if (Image === undefined) return h(Text, { key }, node.fallback)
    return h(Image, {
      key,
      source: { png: node.png.base64 },
      columns: node.columns,
      rows: node.rows,
      // Claude Code requires an alt, and takes a single space for none.
      alt: node.fallback === '' ? ' ' : node.fallback,
    })
  }

  #button(node: ButtonNode, key: string): RenderNode {
    return h(this.#elements.Button, {
      key: buttonKey(node, key),
      label: textOf(node.children),
      plain: true,
      ...(node.hotkey !== undefined && { hotkey: node.hotkey }),
      onPress: () => {
        this.#press(node)
      },
    })
  }
}
