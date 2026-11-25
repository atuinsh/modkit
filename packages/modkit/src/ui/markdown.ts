import * as v from 'valibot'

import { primitive, type Component } from '../runtime/element'

/** Resolved `Markdown` element. */
export interface MarkdownNode {
  kind: 'Markdown'
  text: string
}

export interface MarkdownProps {
  text: string
}

/** Render formatted Markdown content. */
export const Markdown: Component<MarkdownProps> = primitive({
  name: 'Markdown',
  schema: v.object({ text: v.string() }),
  node: ({ props }) => ({ kind: 'Markdown', text: props.text }),
  text: ({ node }) => node.text,
})
