import * as v from 'valibot'

import { primitive, type Component, type ModNode } from '../runtime/element.ts'
import type { UiNode } from './node.ts'
import { HexSchema, ToneSchema, type Hex, type Tone } from './style.ts'

/** Resolved `Text` element. */
export interface TextNode {
  kind: 'Text'
  tone: Tone
  bold: boolean
  color?: Hex
  background?: Hex
  children: readonly UiNode[]
}

export interface TextProps {
  /** Semantic color tone. Defaults to `'plain'`. */
  tone?: Tone
  /** Foreground hex color, overriding `tone`. */
  color?: Hex
  background?: Hex
  bold?: boolean
  children?: ModNode
}

/** Styled text span; may be nested to style part of a line. */
export const Text: Component<TextProps> = primitive({
  name: 'Text',
  schema: v.object({
    tone: v.optional(ToneSchema, 'plain'),
    bold: v.optional(v.boolean(), false),
    color: v.optional(HexSchema),
    background: v.optional(HexSchema),
  }),
  node: ({ props: { tone, bold, color, background }, children }) => ({
    kind: 'Text',
    tone,
    bold,
    ...(color !== undefined && { color }),
    ...(background !== undefined && { background }),
    children,
  }),
  text: ({ node, textOf }) => textOf(node.children),
})
