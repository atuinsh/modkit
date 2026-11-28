/**
 * Interactive side-pane modpart ({@link Pane}) and its prop schema.
 *
 * @module
 */

import * as v from 'valibot'

import { marker, type Component, type ModNode } from '../runtime/element.ts'
import { CallbackSchema, type Callback } from '../runtime/schema.ts'

export interface PaneProps {
  title: string
  id?: string
  onClose?: () => void | Promise<void>
  children?: ModNode
}

export const Pane: Component<PaneProps> = marker('Pane')

const PaneIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/u, 'expected 1 to 64 letters, digits, _ or -'),
)

export const PanePropsSchema: v.GenericSchema<{
  title: string
  id: string
  onClose?: Callback | undefined
}> = v.object({
  title: v.string(),
  id: PaneIdSchema,
  onClose: v.optional(CallbackSchema),
})

export const CommandPanePropsSchema: v.GenericSchema<{ title: string }> = v.object({
  title: v.string(),
})
