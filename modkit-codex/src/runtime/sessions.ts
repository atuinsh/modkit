import { homedir } from 'node:os'
import { join } from 'node:path'

import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { SessionPool } from '@atuin/modkit-target-node/runtime/session-pool'
import { SettingsSchema, type SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'
import type { Images, Mod, Options } from '@atuin/modkit-target/host'

import { CodexMcpConfig } from './configured.ts'
import { LiveSession } from './live-session.ts'

export type { LiveSession } from './live-session.ts'

export interface Served {
  mod: Mod<Options>
  images: Images
  plugin: string
  version: string
  settings: readonly SettingDecl[]
  state: Tags
  hasStatus: boolean
}

export class Sessions implements Disposable {
  readonly #served: Served
  readonly #dir: string
  readonly #settings: SettingsSchema
  readonly #servers: Servers
  readonly #pool = new SessionPool<LiveSession>()

  constructor(served: Served) {
    this.#served = served
    this.#dir = join(
      process.env['CODEX_HOME'] ?? join(homedir(), '.codex'),
      'modkit',
      served.plugin,
    )
    this.#settings = SettingsSchema.from(served.settings)
    const mcp = new CodexMcpConfig()
    this.#servers = new Servers({
      find: async (name) => mcp.resolve(name),
      own: `${served.plugin}-mod`,
    })
  }

  known(id: string): LiveSession | undefined {
    return this.#pool.get(id)
  }

  async open({ id, cwd }: { id: string; cwd: string }): Promise<LiveSession> {
    const known = this.#pool.get(id)
    if (known !== undefined) known.updateCwd(cwd)
    const live =
      known ??
      this.#pool.getOrCreate(id, () =>
        LiveSession.start({
          id,
          cwd,
          dir: this.#dir,
          plugin: this.#served.plugin,
          mod: this.#served.mod,
          images: this.#served.images,
          stateTags: this.#served.state,
          settingsSchema: this.#settings,
          servers: this.#servers,
        }),
      )
    await live.opened
    return live
  }

  [Symbol.dispose](): void {
    this.#pool[Symbol.dispose]()
    this.#servers[Symbol.dispose]()
  }
}
