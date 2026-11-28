import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'smol-toml'
import * as v from 'valibot'

import type { Env } from '@atuin/modkit-target'

import { PluginSelector } from './plugin-selector.ts'

// The part of `config.toml` `modkit dev` reads: a table per plugin Codex installs, by selector.
const ConfigSchema = v.object({ plugins: v.optional(v.record(v.string(), v.unknown()), {}) })

/** The user's Codex config, `config.toml` in `CODEX_HOME`, `~/.codex` when unset. */
export class CodexConfig {
  readonly #plugins: readonly PluginSelector[]

  private constructor(plugins: readonly PluginSelector[]) {
    this.#plugins = plugins
  }

  /** The config Codex reads in `env`, which is empty while Codex has written none. */
  static read(env: Env): CodexConfig {
    const path = join(env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'config.toml')
    const text = (() => {
      try {
        return readFileSync(path, 'utf8')
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
        throw error
      }
    })()
    const { plugins } = v.parse(ConfigSchema, parse(text))
    return new CodexConfig(Object.keys(plugins).flatMap((raw) => PluginSelector.parse(raw) ?? []))
  }

  /** The copies of `plugin` the config installs, from any marketplace. */
  installed(plugin: string): readonly PluginSelector[] {
    return this.#plugins.filter((selector) => selector.plugin === plugin)
  }
}
