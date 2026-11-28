import { homedir } from 'node:os'
import { join } from 'node:path'

import { NodeHarness } from '@atuin/modkit-target-node/runtime/harness'
import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { SettingsSchema, type SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import { fileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  failureReporter,
  type HarnessAdapter,
  type Images,
  type Mod,
  type Options,
} from '@atuin/modkit-target/host'

import { configuredServer } from './configured'
import { LiveSession, type SessionState } from './live-session'
import { CodexRuntime } from './runtime'

export type { LiveSession } from './live-session'

const NO_MODEL = "Codex gives a plugin's MCP server no model to call"

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
  readonly #live = new Map<string, LiveSession>()

  constructor(served: Served) {
    this.#served = served
    this.#dir = join(
      process.env['CODEX_HOME'] ?? join(homedir(), '.codex'),
      'modkit',
      served.plugin,
    )
    this.#settings = SettingsSchema.from(served.settings)
    this.#servers = new Servers({ find: configuredServer, own: `${served.plugin}-mod` })
  }

  known(id: string): LiveSession | undefined {
    return this.#live.get(id)
  }

  async open({ id, cwd }: { id: string; cwd: string }): Promise<LiveSession> {
    const known = this.#live.get(id)
    if (known !== undefined) known.updateCwd(cwd)
    const live = known ?? this.#start({ id, cwd })
    await live.opened
    return live
  }

  [Symbol.dispose](): void {
    for (const live of this.#live.values()) live[Symbol.dispose]()
    this.#servers[Symbol.dispose]()
  }

  #start({ id, cwd }: { id: string; cwd: string }): LiveSession {
    const { plugin, mod, images } = this.#served
    const state: SessionState = { id, cwd, notes: [], context: [] }
    const settings = this.#settings.loadFile(join(this.#dir, 'settings.json'))
    for (const problem of settings.problems) state.notes.push(`${plugin}: ${problem}`)
    const runtime = settings.isOk
      ? new CodexRuntime({ mod, options: settings.options, images })
      : undefined
    const opened = runtime?.open({ harness: this.#buildHarness(state) }) ?? Promise.resolve()
    const live = new LiveSession({ state, runtime, opened })
    this.#live.set(id, live)
    return live
  }

  #buildHarness(state: SessionState): HarnessAdapter {
    const report = failureReporter({
      plugin: this.#served.plugin,
      notify: (line) => {
        state.notes.push(line)
      },
      log: (line) => {
        process.stderr.write(`${line}\n`)
      },
    })
    const store = fileStore({
      dir: join(this.#dir, 'sessions'),
      session: state.id,
      tags: this.#served.state,
      report,
    })
    return NodeHarness.builder({
      sessionId: state.id,
      cwd: () => state.cwd,
      servers: this.#servers,
      store,
      report,
    })
      .withNotify((text) => {
        state.notes.push(text)
        return 'queued'
      })
      .withInject(async (text) => {
        state.context.push(text)
        return 'queued'
      })
      .withModelRefusal(NO_MODEL)
      .build()
  }
}
