import {
  MODPARTS,
  type Diagnostic,
  type ModpartName,
  type ModpartUsage,
} from '@atuin/modkit-compiler'

import type { Support } from './capabilities.ts'
import type { Selected } from './load.ts'
import { manifestError } from './manifest.ts'
import type { CompiledMod } from './target.ts'

type Short = Exclude<Support, { kind: 'native' }>

/** A modpart the mod writes that a target lowers or drops, and the mod accepts. */
export interface Gap {
  target: string
  modpart: ModpartName
  support: Short
  usage: ModpartUsage
}

const VERBS: Readonly<Record<Short['kind'], string>> = { lowered: 'lowers', dropped: 'drops' }

/** What a target does to a modpart it falls short on: `drops panes: Codex draws no panes`. */
export const gapText = ({ modpart, support }: Pick<Gap, 'modpart' | 'support'>): string =>
  `${VERBS[support.kind]} ${modpart}: ${support.why}`

/** What the gaps check of one modpart on one target found, if anything. */
type Found = { isGap: true; gap: Gap } | { isGap: false; diagnostic: Diagnostic } | undefined

function foundFor({
  selected,
  modpart,
  compiled,
  dir,
}: {
  selected: Selected
  modpart: ModpartName
  compiled: CompiledMod
  dir: string
}): Found {
  const { name } = selected.target
  const support = selected.target.capabilities[modpart]
  const usage = compiled.modparts[modpart]
  const isAccepted = selected.gaps.includes(modpart)
  const stale = (message: string): Found => ({
    isGap: false,
    diagnostic: manifestError({ code: 'stale-gap', message, dir }),
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
  if (isAccepted) return { isGap: true, gap: { target: name, modpart, support, usage } }
  const message = `${name} ${gapText({ modpart, support })}; to build for it anyway, add "${modpart}" to modkit.${name}.gaps in package.json`
  return { isGap: false, diagnostic: { code: 'target-gap', message, ...usage.at } }
}

/**
 * Check the mod's modparts against what each target provides.
 *
 * A target that lowers or drops a modpart the mod writes fails the build until the mod accepts the
 * gap in `package.json`; an accepted gap the target or the mod does not have fails it too.
 */
export function gapsIn({
  compiled,
  selected,
  dir,
}: {
  compiled: CompiledMod
  selected: readonly Selected[]
  dir: string
}): { accepted: Gap[]; diagnostics: Diagnostic[] } {
  const found = selected.flatMap((one) =>
    MODPARTS.map((modpart) => foundFor({ selected: one, modpart, compiled, dir })),
  )
  return {
    accepted: found.flatMap((one) => (one?.isGap === true ? [one.gap] : [])),
    diagnostics: found.flatMap((one) => (one?.isGap === false ? [one.diagnostic] : [])),
  }
}
