/**
 * Status bar / footer modpart ({@link Status}).
 *
 * @module
 */

import { marker, type ModNode } from '../runtime/element'

export interface StatusProps {
  children?: ModNode
}

/** Render a compact indicator in the harness's status bar or footer. */
export const Status = marker<StatusProps>('Status')
