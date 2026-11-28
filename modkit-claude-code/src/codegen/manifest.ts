/**
 * Generator for Claude Code's `.claude-plugin/plugin.json` manifest and `userConfig` schema.
 *
 * @module
 */

import type { ArtifactEmitter, ArtifactWriter, ModInfo, OptionDecl } from '@atuin/modkit-target'

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

export interface ManifestJson {
  name: string
  version: string
  description: string
  author?: ModInfo['author']
  types: string
  userConfig?: Readonly<Record<string, UserConfigField>>
}

/** Builder for Claude Code's `.claude-plugin/plugin.json` and `hooks/hooks.json` manifests. */
export class ClaudeManifest implements ArtifactEmitter {
  readonly #plugin: string
  readonly #mod: ModInfo
  readonly #options: readonly OptionDecl[]

  constructor({
    plugin,
    mod,
    options,
  }: {
    plugin: string
    mod: ModInfo
    options: readonly OptionDecl[]
  }) {
    this.#plugin = plugin
    this.#mod = mod
    this.#options = options
  }

  /**
   * Build the `.claude-plugin/plugin.json` manifest object for this plugin.
   *
   * Maps `options` into Claude Code's `userConfig` object (`strings` options become `type: 'string'`
   * with `multiple: true`); omits `userConfig` when the mod declares no settings.
   */
  toJson(): ManifestJson {
    const mod = this.#mod
    const options = this.#options
    return {
      name: this.#plugin,
      version: mod.version,
      description: mod.description,
      ...(mod.author !== undefined && { author: mod.author }),
      types: './types/index.d.ts',
      ...(options.length > 0 && {
        userConfig: Object.fromEntries(options.map((option) => [option.name, fieldOf(option)])),
      }),
    }
  }

  emitTo(emit: ArtifactWriter): void {
    emit.json('.claude-plugin/plugin.json', this.toJson())
    emit.json('hooks/hooks.json', { modules: ['./register.js'] })
  }
}
