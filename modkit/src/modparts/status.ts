/**
 * Status bar / footer modpart ({@link Status}).
 *
 * @module
 */

import { marker, type Component, type ModNode } from '../runtime/element.ts'

export interface StatusProps {
  children?: ModNode
}

/** Render a compact indicator in the harness's status bar or footer. */
export const Status: Component<StatusProps> = marker('Status')
