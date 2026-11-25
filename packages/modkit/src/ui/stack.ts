import * as v from 'valibot'

import { primitive, type Component, type ModNode } from '../runtime/element'
import type { UiNode } from './node'
import { BorderSchema, NonNegIntSchema, ToneSchema, type Border, type Tone } from './style'

/** Resolved `Column` or `Row` container. */
export interface StackNode {
  kind: 'Column' | 'Row'
  gap: number
  border?: Border
  borderTone?: Tone
  paddingX?: number
  paddingY?: number
  children: readonly UiNode[]
}

export interface StackProps {
  /** Non-negative cell gap between children (lines in `Column`, cols in `Row`). Defaults to `0`. */
  gap?: number
  border?: Border
  /** Semantic tone for the border. Requires `border` to be set. */
  borderTone?: Tone
  /** Horizontal inner padding in terminal columns. */
  paddingX?: number
  /** Vertical inner padding in terminal lines. */
  paddingY?: number
  children?: ModNode
}

const StackPropsSchema = v.pipe(
  v.object({
    gap: v.optional(NonNegIntSchema, 0),
    border: v.optional(BorderSchema),
    borderTone: v.optional(ToneSchema),
    paddingX: v.optional(NonNegIntSchema),
    paddingY: v.optional(NonNegIntSchema),
  }),
  v.check(
    ({ border, borderTone }) => borderTone === undefined || border !== undefined,
    'borderTone requires border to be set',
  ),
)

const stack = ({
  kind,
  between,
}: {
  kind: StackNode['kind']
  between: (gap: number) => string
}): Component<StackProps> =>
  primitive({
    name: kind,
    schema: StackPropsSchema,
    node: ({ props: { gap, border, borderTone, paddingX, paddingY }, children }) => ({
      kind,
      gap,
      ...(border !== undefined && { border }),
      ...(borderTone !== undefined && { borderTone }),
      ...(paddingX !== undefined && { paddingX }),
      ...(paddingY !== undefined && { paddingY }),
      children,
    }),
    text: ({ node, textOf }) =>
      node.children.map((child) => textOf([child])).join(between(node.gap)),
  })

/** Vertical flex container that stacks children top to bottom. */
export const Column = stack({ kind: 'Column', between: (gap) => '\n'.repeat(gap + 1) })

/** Horizontal flex container that arranges children left to right. */
export const Row = stack({ kind: 'Row', between: (gap) => ' '.repeat(Math.max(1, gap)) })
