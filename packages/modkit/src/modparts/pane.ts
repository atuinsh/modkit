/**
 * Interactive side-pane modpart ({@link Pane}) and its prop schema.
 *
 * @module
 */

import * as v from 'valibot'

import { marker, type ModNode } from '../runtime/element'
import { CallbackSchema } from '../runtime/schema'

export interface PaneProps {
  title: string
  id?: string
  onClose?: () => void | Promise<void>
  children?: ModNode
}

export const Pane = marker<PaneProps>('Pane')

const PaneIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]{1,64}$/u, 'expected 1 to 64 letters, digits, _ or -'),
)

export const PanePropsSchema = v.object({
  title: v.string(),
  id: PaneIdSchema,
  onClose: v.optional(CallbackSchema),
})

export const CommandPanePropsSchema = v.object({ title: v.string() })
