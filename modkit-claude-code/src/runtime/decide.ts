/**
 * Bash exit-code parsing and tool-check verdict merging for Claude Code hooks.
 *
 * @module
 */

import type { ToolCallResult, ToolCheckResult } from 'claude-code'

import type { Verdict } from '@atuin/modkit-target/host'

/**
 * Parse a Bash call's exit code from Claude Code's {@link ToolCallResult}.
 *
 * Returns `0` when `ran.isError` is not `true`, parses a leading `Exit code <n>` prefix on error,
 * or returns `null` if no exit code prefix is present.
 */
export function exitCodeOf(ran: ToolCallResult): number | null {
  if (ran.isError !== true) return 0
  const code = /^Exit code (?<code>\d+)/u.exec(ran.text ?? '')?.groups?.['code']
  return code === undefined ? null : Number(code)
}

/**
 * Combine Claude Code's existing `verdict` with a mod's {@link Verdict} (`mine`).
 *
 * A `'deny'` from either side always wins. An `Ask` verdict becomes `'ask'` when `canAsk` is
 * `true`; otherwise it falls back to `'deny'` if `mine.otherwise === 'deny'` or preserves
 * `verdict`.
 */
export function decide({
  verdict,
  mine,
  canAsk,
}: {
  verdict: ToolCheckResult
  mine: Verdict
  canAsk: boolean
}): ToolCheckResult {
  if (mine === undefined || verdict.decision === 'deny') return verdict
  if ('deny' in mine) return { decision: 'deny', reason: mine.deny }
  if (canAsk) return { decision: 'ask', reason: mine.ask }
  return mine.otherwise === 'deny' ? { decision: 'deny', reason: mine.ask } : verdict
}
