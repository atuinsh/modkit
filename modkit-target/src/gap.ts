import type { ModpartName } from '@atuin/modkit-compiler'

import type { Support } from './host/capabilities.ts'

export type ShortSupport = Exclude<Support, { kind: 'native' }>

const VERBS: Readonly<Record<ShortSupport['kind'], string>> = {
  lowered: 'lowers',
  dropped: 'drops',
}

/** A modpart the mod writes that a target lowers or drops, and the mod accepts. */
export class Gap {
  readonly #modpart: ModpartName
  readonly #support: ShortSupport

  constructor({ modpart, support }: { modpart: ModpartName; support: ShortSupport }) {
    this.#modpart = modpart
    this.#support = support
  }

  get modpart(): ModpartName {
    return this.#modpart
  }

  get support(): ShortSupport {
    return this.#support
  }

  /** Human-readable summary of the gap: `drops panes: Codex draws no panes`. */
  toString(): string {
    return `${VERBS[this.#support.kind]} ${this.#modpart}: ${this.#support.why}`
  }
}
