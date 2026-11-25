/**
 * Translators from Claude Code MCP and model-completion responses to `@atuin/modkit` result types.
 *
 * @module
 */

import type { McpToolResult, ModelCompleteResult } from 'claude-code'

import type { Completion, McpResult } from '@atuin/modkit'

const textOf = (result: McpToolResult): string =>
  result.content.flatMap((block) => (block.type === 'text' ? [block.text ?? ''] : [])).join('\n')

/**
 * Convert a Claude Code {@link McpToolResult} into a modkit {@link McpResult}, joining text blocks
 * with `\n`.
 */
export function mcpResultOf(result: McpToolResult): McpResult {
  const text = textOf(result)
  if (result.isError) {
    return { isOk: false, reason: text === '' ? 'the tool failed and said nothing more' : text }
  }
  return {
    isOk: true,
    text,
    ...(result.structuredContent !== undefined && { structured: result.structuredContent }),
  }
}

const NO_TEXT = {
  'empty-reply': 'the model replied with no text',
  aborted: 'the call ran out of time or was cut short',
} as const

/** Convert a Claude Code {@link ModelCompleteResult} into a modkit {@link Completion}. */
export function completionOf(result: ModelCompleteResult): Completion {
  if (result.isAnswered) return { isAnswered: true, text: result.text }
  if (result.reason !== 'api-error') {
    return { isAnswered: false, reason: result.reason, detail: NO_TEXT[result.reason] }
  }
  const status = result.status === null ? 'no response' : `status ${result.status}`
  return { isAnswered: false, reason: 'api-error', detail: `${result.error}, ${status}` }
}
