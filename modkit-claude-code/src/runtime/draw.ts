/**
 * Translator from `@atuin/modkit` {@link UiNode} trees to Claude Code `h()` render nodes.
 *
 * Claude Code's `Text` element only accepts strings and nested `Text` elements, so non-`Text`
 * children inside a `Text` node are flattened via `textOf()`, while bare strings outside a `Text`
 * node are wrapped in one. Every emitted element receives a deterministic key (`at.<index>`, or
 * explicit `key` / `hotkey:<k>` on buttons).
 *
 * @module
 */

import type { Elements, RenderNode } from 'claude-code'

import {
  textOf,
  type ButtonNode,
  type StackNode,
  type TextNode,
  type Tone,
  type UiNode,
} from '@atuin/modkit'

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
      if (typeof node === 'string') return h(elements.Text, { key }, node)
      switch (node.kind) {
        case 'Text':
          return this.#text(node, key)
        case 'Column':
        case 'Row':
          return h(elements.Box, { key, ...boxProps(node) }, ...this.nodes(node.children, key))
        case 'Button':
          return this.#button(node, key)
        case 'Markdown':
          break
      }
      return h(elements.Markdown, { key, text: node.text })
    })
  }

  #text(node: TextNode, key: string): RenderNode {
    const children = node.children.map((child, index) =>
      typeof child === 'string' || child.kind !== 'Text'
        ? textOf([child])
        : this.#text(child, `${key}.${index}`),
    )
    const props = {
      key,
      ...toneProps(node.tone),
      ...(node.color !== undefined && { color: node.color }),
      ...(node.background !== undefined && { backgroundColor: node.background }),
      ...(node.bold && { weight: 'bold' }),
    }
    return h(this.#elements.Text, props, ...children)
  }

  #button(node: ButtonNode, key: string): RenderNode {
    return h(this.#elements.Button, {
      // A key or a hotkey names its button for good; a position moves as the list around it does.
      key: node.key ?? (node.hotkey === undefined ? key : `hotkey:${node.hotkey}`),
      label: textOf(node.children),
      plain: true,
      ...(node.hotkey !== undefined && { hotkey: node.hotkey }),
      onPress: () => {
        this.#press(node)
      },
    })
  }
}
