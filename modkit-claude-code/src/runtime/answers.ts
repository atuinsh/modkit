/**
 * Translators from Claude Code model-completion responses to `@atuin/modkit` result types.
 *
 * @module
 */

import type { ModelCompleteResult } from 'claude-code'

import type { Completion } from '@atuin/modkit-target/host'

const NO_TEXT = {
  'empty-reply': 'the model replied with no text',
  aborted: 'the call ran out of time or was cut short',
} as const

/** Bound wrapper around a Claude Code {@link ModelCompleteResult} response. */
export class ClaudeCompletion {
  readonly #result: ModelCompleteResult

  constructor(result: ModelCompleteResult) {
    this.#result = result
  }

  /** Convert this Claude Code response into a modkit {@link Completion}. */
  toCompletion(): Completion {
    const result = this.#result
    if (result.isAnswered) return { isAnswered: true, text: result.text }
    if (result.reason !== 'api-error') {
      return { isAnswered: false, reason: result.reason, detail: NO_TEXT[result.reason] }
    }
    const status = result.status === null ? 'no response' : `status ${result.status}`
    return { isAnswered: false, reason: 'api-error', detail: `${result.error}, ${status}` }
  }
}
