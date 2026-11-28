const PANE_ID_LENGTH = 64

/** Validated pane identifier constrained to 1-64 ASCII `[A-Za-z0-9_-]` characters. */
export class PaneId {
  readonly #value: string

  private constructor(value: string) {
    this.#value = value
  }

  /** Derive a pane identifier from a slash command name. */
  static fromCommand(command: string): PaneId {
    return new PaneId(command.replaceAll(/[^A-Za-z0-9_-]/gu, '-').slice(0, PANE_ID_LENGTH))
  }

  /** Wrap an already-valid pane identifier from a mod or harness. */
  static parse(raw: string): PaneId {
    return new PaneId(raw)
  }

  toString(): string {
    return this.#value
  }

  equals(other: string | PaneId): boolean {
    return this.#value === (typeof other === 'string' ? other : other.#value)
  }
}
