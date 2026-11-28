import type { Delivered } from '../protocol'
import type { CodexRuntime } from './runtime'

export interface SessionState {
  readonly id: string
  cwd: string
  notes: string[]
  context: string[]
}

export class LiveSession implements Disposable {
  readonly #state: SessionState
  readonly #runtime: CodexRuntime | undefined
  readonly #opened: Promise<void>

  constructor({
    state,
    runtime,
    opened,
  }: {
    state: SessionState
    runtime: CodexRuntime | undefined
    opened: Promise<void>
  }) {
    this.#state = state
    this.#runtime = runtime
    this.#opened = opened
  }

  get runtime(): CodexRuntime | undefined {
    return this.#runtime
  }

  get opened(): Promise<void> {
    return this.#opened
  }

  updateCwd(cwd: string): void {
    this.#state.cwd = cwd
  }

  queueNote(note: string): void {
    this.#state.notes.push(note)
  }

  drain(carriesContext: boolean): Delivered {
    return {
      notes: this.#state.notes.splice(0),
      context: carriesContext ? this.#state.context.splice(0) : [],
    }
  }

  [Symbol.dispose](): void {
    this.#runtime?.[Symbol.dispose]()
  }
}
