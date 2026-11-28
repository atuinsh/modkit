import { MODPARTS, type Diagnostic, type ModpartName } from '@atuin/modkit-compiler'

import type { DevHarness, DevInput } from './dev.ts'
import type { Support } from './host/capabilities.ts'
import type { ModPackage } from './package.ts'
import type { Built, CompiledMod, ModkitTarget } from './target.ts'

type Short = Exclude<Support, { kind: 'native' }>

/** A modpart the mod writes that a target lowers or drops, and the mod accepts. */
export interface Gap {
  modpart: ModpartName
  support: Short
}

const VERBS: Readonly<Record<Short['kind'], string>> = { lowered: 'lowers', dropped: 'drops' }

/** What a target does to a modpart it falls short on: `drops panes: Codex draws no panes`. */
export const gapText = ({ modpart, support }: Gap): string =>
  `${VERBS[support.kind]} ${modpart}: ${support.why}`

/** What checking one modpart found: a gap the mod accepts, a gap it does not, or nothing. */
type Found = { isGap: true; gap: Gap } | { isGap: false; diagnostic: Diagnostic } | undefined

/** What checking a mod against a target found: the gaps it accepts, and why it can't be built. */
export interface Checked {
  gaps: Gap[]
  diagnostics: Diagnostic[]
}

/**
 * A target a mod's package.json lists, loaded from the mod's `node_modules`, with the gaps the mod
 * accepts there and the options it gives it.
 */
export class ListedTarget {
  readonly #listedBy: ModPackage
  readonly #target: ModkitTarget
  readonly #gaps: readonly ModpartName[]
  readonly #options: unknown

  constructor({
    listedBy,
    target,
    gaps,
    options,
  }: {
    listedBy: ModPackage
    target: ModkitTarget
    gaps: readonly ModpartName[]
    options: unknown
  }) {
    this.#listedBy = listedBy
    this.#target = target
    this.#gaps = gaps
    this.#options = options
  }

  /** The name the mod lists the target by, `claude-code`. */
  get name(): string {
    return this.#target.name
  }

  /**
   * Check the mod's modparts against what the target provides.
   *
   * A modpart the mod writes and the target lowers or drops fails the build until the mod accepts
   * the gap in package.json; an accepted gap the target or the mod does not have fails it too.
   */
  check(compiled: CompiledMod): Checked {
    const found = MODPARTS.map((modpart) => this.#found(modpart, compiled))
    return {
      gaps: found.flatMap((one) => (one?.isGap === true ? [one.gap] : [])),
      diagnostics: found.flatMap((one) => (one?.isGap === false ? [one.diagnostic] : [])),
    }
  }

  /** Build the mod for the target into `out`, with the options the mod gives it. */
  async build(compiled: CompiledMod, out: string): Promise<Built> {
    const { dir } = this.#listedBy
    return this.#target.build({ compiled, dir, out, options: this.#options })
  }

  /** The harness `modkit dev` runs the target's build in. */
  dev(input: DevInput): DevHarness {
    return this.#target.dev(input)
  }

  #found(modpart: ModpartName, compiled: CompiledMod): Found {
    const { name } = this
    const support = this.#target.capabilities[modpart]
    const usage = compiled.modparts[modpart]
    const isAccepted = this.#gaps.includes(modpart)
    const stale = (message: string): Found => ({
      isGap: false,
      diagnostic: this.#listedBy.error('stale-gap', message),
    })
    if (support.kind === 'native') {
      return isAccepted
        ? stale(`${name} provides ${modpart}; drop it from modkit.${name}.gaps`)
        : undefined
    }
    if (usage === undefined) {
      return isAccepted
        ? stale(`the mod has no ${modpart}; drop it from modkit.${name}.gaps`)
        : undefined
    }
    if (isAccepted) return { isGap: true, gap: { modpart, support } }
    const message = `${name} ${gapText({ modpart, support })}; to build for it anyway, add "${modpart}" to modkit.${name}.gaps in package.json`
    return { isGap: false, diagnostic: { code: 'target-gap', message, ...usage.at } }
  }
}
