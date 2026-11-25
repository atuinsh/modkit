import * as v from 'valibot'

import type { Surface } from '../harness/types'
import { primitive, type Component, type ModNode } from '../runtime/element'
import { CallbackSchema } from '../runtime/schema'
import type { UiNode } from './node'

/** Context passed to `Button`'s `onPress` handler when the user activates a button. */
export interface Press {
  /** Surface where the button was pressed (used to target actions like clipboard copy). */
  surface: Surface
}

/** Resolved `Button` element with a fault-isolated `press` callback. */
export interface ButtonNode {
  kind: 'Button'
  /** Explicit element `key`, used by targets to preserve button identity across list updates. */
  key?: string
  hotkey: string | undefined
  children: readonly UiNode[]
  /** Invoke the button's `onPress` handler. Exceptions are reported and never thrown. */
  press: (press: Press) => Promise<void>
}

export interface ButtonProps {
  /** Single key shortcut that triggers this button while its pane has keyboard focus. */
  hotkey?: string
  onPress: (press: Press) => unknown
  children?: ModNode
}

/** Interactive button rendered inside a pane, status bar, or tool card. */
export const Button: Component<ButtonProps> = primitive({
  name: 'Button',
  schema: v.object({ hotkey: v.optional(v.string()), onPress: CallbackSchema }),
  node: ({ props, key, children, scope }) => ({
    kind: 'Button',
    ...(key !== undefined && { key }),
    hotkey: props.hotkey,
    children,
    press: scope.action(props.onPress),
  }),
  text: ({ node, textOf }) =>
    `${node.hotkey === undefined ? '' : `[${node.hotkey}] `}${textOf(node.children)}`,
})
