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

function textElement({
  elements,
  node,
  key,
}: {
  elements: Elements
  node: TextNode
  key: string
}): RenderNode {
  const children = node.children.map((child, index) =>
    typeof child === 'string' || child.kind !== 'Text'
      ? textOf([child])
      : textElement({ elements, node: child, key: `${key}.${index}` }),
  )
  const props = {
    key,
    ...toneProps(node.tone),
    ...(node.color !== undefined && { color: node.color }),
    ...(node.background !== undefined && { backgroundColor: node.background }),
    ...(node.bold && { weight: 'bold' }),
  }
  return h(elements.Text, props, ...children)
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
 * Convert `nodes` into Claude Code {@link RenderNode} elements using surface-resolved `elements`.
 *
 * `press` handles button clicks on the active surface's `$`, and `at` prefixes positional keys
 * (defaults to `'n'`).
 */
export function draw({
  elements,
  nodes,
  press,
  at = 'n',
}: {
  elements: Elements
  nodes: readonly UiNode[]
  press: (button: ButtonNode) => void
  at?: string
}): RenderNode[] {
  return nodes.map((node, index): RenderNode => {
    const key = `${at}.${index}`
    if (typeof node === 'string') return h(elements.Text, { key }, node)
    switch (node.kind) {
      case 'Text':
        return textElement({ elements, node, key })
      case 'Column':
      case 'Row': {
        const children = draw({ elements, nodes: node.children, press, at: key })
        return h(elements.Box, { key, ...boxProps(node) }, ...children)
      }
      case 'Button':
        return h(elements.Button, {
          // A key or a hotkey names its button for good; a position moves as the list around it does.
          key: node.key ?? (node.hotkey === undefined ? key : `hotkey:${node.hotkey}`),
          label: textOf(node.children),
          plain: true,
          ...(node.hotkey !== undefined && { hotkey: node.hotkey }),
          onPress: () => {
            press(node)
          },
        })
      case 'Markdown':
        break
    }
    return h(elements.Markdown, { key, text: node.text })
  })
}
