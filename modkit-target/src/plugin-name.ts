import { ModManifest } from '@atuin/modkit-compiler'

/** Validated harness plugin name derived from a mod's package name. */
export class PluginName {
  readonly #value: string

  private constructor(value: string) {
    this.#value = value
  }

  /** Derive the plugin name for a mod's `package.json` `name`. */
  static fromPackage(pkgName: string): PluginName {
    return new PluginName(ModManifest.pluginName(pkgName))
  }

  /** Wrap an already-normalized plugin name. */
  static parse(raw: string): PluginName {
    if (raw === '') throw new TypeError('a plugin name cannot be empty')
    return new PluginName(raw)
  }

  toString(): string {
    return this.#value
  }

  /** Harness server/plugin identifier (`<plugin>-mod`). */
  serverName(): string {
    return `${this.#value}-mod`
  }

  /** MCP status line resource URI (`ui://<plugin>/statusline`). */
  statusUri(): string {
    return `ui://${this.#value}/statusline`
  }
}
