import type { SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'
import type { Images, Mod, Options } from '@atuin/modkit-target/host'

export interface Served {
  mod: Mod<Options>
  images: Images
  plugin: string
  settings: readonly SettingDecl[]
  state: Tags
}
