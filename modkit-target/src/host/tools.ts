const CANONICAL_SHELL = 'Bash'

/** Canonical bidirectional mapping between a harness's tool names and modkit's tool names. */
export class HarnessTools {
  readonly #harness: string
  readonly #shell: string
  readonly #canonical: ReadonlySet<string>

  constructor({
    harness,
    shell = CANONICAL_SHELL,
    builtin,
  }: {
    harness: string
    shell?: string
    builtin: readonly string[]
  }) {
    this.#harness = harness
    this.#shell = shell
    this.#canonical = new Set([CANONICAL_SHELL, ...builtin])
  }

  /** Human-readable harness name used in build diagnostics. */
  get harness(): string {
    return this.#harness
  }

  /** Harness-native name of the shell tool (e.g. `'bash'`, `'shell'`, `'Bash'`). */
  get shell(): string {
    return this.#shell
  }

  /** Whether `harnessTool` is this harness's shell tool. */
  isShell(harnessTool: string): boolean {
    return harnessTool === this.#shell
  }

  /** Translate a harness-native tool name to modkit's canonical name (`'Bash'` for shell). */
  toModTool(harnessTool: string): string {
    return harnessTool === this.#shell ? CANONICAL_SHELL : harnessTool
  }

  /** Translate a modkit canonical tool name to this harness's native name. */
  toHarnessTool(modTool: string): string {
    return modTool === CANONICAL_SHELL ? this.#shell : modTool
  }

  /** Build notes warning about mod-hooked tools that this harness does not provide. */
  missingNotes(tools: {
    before: readonly string[]
    after: readonly string[]
    cards: readonly string[]
  }): string[] {
    const hooked = new Set<string>([...tools.before, ...tools.after, ...tools.cards])
    return hooked
      .difference(this.#canonical)
      .values()
      .filter((tool) => !tool.startsWith('mcp__'))
      .toArray()
      .toSorted()
      .map(
        (tool) =>
          `${this.#harness} has no ${tool} tool, so what the mod does on it never runs there`,
      )
  }
}
