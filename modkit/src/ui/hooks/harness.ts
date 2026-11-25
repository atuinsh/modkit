import type { Harness } from '../../harness/types'
import { activeFrame } from '../../runtime/frame'

/** Return the {@link Harness} interface for the currently rendering mod. */
export function useHarness(): Harness {
  return activeFrame('useHarness').scope.harness
}
