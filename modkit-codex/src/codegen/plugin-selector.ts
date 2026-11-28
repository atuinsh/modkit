/** A plugin as Codex installs it from a marketplace, `atuin@atuin-local`. */
export class PluginSelector {
  readonly plugin: string
  readonly marketplace: string

  constructor({ plugin, marketplace }: { plugin: string; marketplace: string }) {
    this.plugin = plugin
    this.marketplace = marketplace
  }

  /** The selector `raw`, `atuin@atuin-local`, if it is one. */
  static parse(raw: string): PluginSelector | undefined {
    const at = raw.lastIndexOf('@')
    if (at <= 0) return undefined
    return new PluginSelector({ plugin: raw.slice(0, at), marketplace: raw.slice(at + 1) })
  }

  /** Whether `other` selects the same plugin from the same marketplace. */
  equals(other: PluginSelector): boolean {
    return this.toString() === other.toString()
  }

  toString(): string {
    return `${this.plugin}@${this.marketplace}`
  }
}
