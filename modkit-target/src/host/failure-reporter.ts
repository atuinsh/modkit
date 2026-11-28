import type { Failure } from '@atuin/modkit/host'

import { errorMessage } from './values.ts'

/** Formats and deduplicates mod failures for a plugin's error reporter. */
export class FailureReporter {
  readonly #plugin: string
  readonly #notify: (line: string) => void
  readonly #log: ((line: string) => void) | undefined
  readonly #reported = new Set<string>()

  private constructor({
    plugin,
    notify,
    log,
  }: {
    plugin: string
    notify: (line: string) => void
    log?: (line: string) => void
  }) {
    this.#plugin = plugin
    this.#notify = notify
    this.#log = log
  }

  /** Construct a deduplicating reporter bound to `plugin`. */
  static for(options: {
    plugin: string
    notify: (line: string) => void
    log?: (line: string) => void
  }): FailureReporter {
    return new FailureReporter(options)
  }

  /** Report a mod {@link Failure}, notifying the user at most once per distinct message. */
  readonly report: (failure: Failure) => void = ({ phase, error }) => {
    const line = `${this.#plugin}: ${phase} failed: ${errorMessage(error)}`
    this.#log?.(line)
    if (this.#reported.has(line)) return
    this.#reported.add(line)
    this.#notify(line)
  }
}
