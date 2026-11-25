/**
 * Generator for Claude Code's `.claude-plugin/plugin.json` manifest and `userConfig` schema.
 *
 * @module
 */

import type { ModInfo, OptionDecl } from '@atuin/modkit-compiler'

interface UserConfigField {
  type: 'string' | 'number' | 'boolean'
  title: string
  description: string
  required?: true
  sensitive?: true
  multiple?: true
  options?: readonly string[]
  default?: string | number | boolean | readonly string[]
}

function fieldOf(option: OptionDecl): UserConfigField {
  return {
    type: option.kind === 'strings' ? 'string' : option.kind,
    ...(option.kind === 'strings' && { multiple: true as const }),
    title: option.title,
    description: option.description,
    ...(option.isRequired && { required: true as const }),
    ...(option.isSensitive && { sensitive: true as const }),
    ...(option.kind === 'string' && option.choices !== undefined && { options: option.choices }),
    ...(option.default !== undefined && { default: option.default }),
  }
}

interface Manifest {
  name: string
  version: string
  description: string
  author?: ModInfo['author']
  types: string
  userConfig?: Readonly<Record<string, UserConfigField>>
}

/**
 * Build the `.claude-plugin/plugin.json` manifest object for `plugin`.
 *
 * Maps `options` into Claude Code's `userConfig` object (`strings` options become `type: 'string'`
 * with `multiple: true`); omits `userConfig` when the mod declares no settings.
 */
export function manifestOf({
  plugin,
  mod,
  options,
}: {
  plugin: string
  mod: ModInfo
  options: readonly OptionDecl[]
}): Manifest {
  return {
    name: plugin,
    version: mod.version,
    description: mod.description,
    ...(mod.author !== undefined && { author: mod.author }),
    types: './types/index.d.ts',
    ...(options.length > 0 && {
      userConfig: Object.fromEntries(options.map((option) => [option.name, fieldOf(option)])),
    }),
  }
}
