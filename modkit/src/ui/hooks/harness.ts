import type { Harness } from '../../harness/types.ts'
import { activeFrame } from '../../runtime/frame.ts'

/** Return the {@link Harness} interface for the currently rendering mod. */
export function useHarness(): Harness {
  return activeFrame('useHarness').scope.harness
}
