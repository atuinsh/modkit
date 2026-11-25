import type { SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Mod, Options } from '@atuin/modkit-target/host'

export interface Served {
  mod: Mod<Options>
  plugin: string
  settings: readonly SettingDecl[]
}
