import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Servers } from '@atuin/modkit-target-node/runtime/servers'
import { settingsFrom, type SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import { fileStore } from '@atuin/modkit-target-node/runtime/store'
import type { Mod, Options } from '@atuin/modkit-target/host'

import { configuredServer } from './configured'
import { harnessFor, reporterFor, type SessionState } from './harness'
import { serverNameOf } from './names'
import { CodexRuntime, type CodexSession } from './runtime'

export interface Served {
  mod: Mod<Options>
  plugin: string
  version: string
  settings: readonly SettingDecl[]
  hasStatus: boolean
}

export interface Live {
  state: SessionState
  runtime: CodexRuntime | undefined
  opened: Promise<void>
  repeats: NodeJS.Timeout[]
}

const modDirOf = (plugin: string): string =>
  join(process.env['CODEX_HOME'] ?? join(homedir(), '.codex'), 'modkit', plugin)

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export class Sessions {
  readonly #served: Served
  readonly #dir: string
  readonly #servers: Servers
  readonly #live = new Map<string, Live>()

  constructor(served: Served) {
    this.#served = served
    this.#dir = modDirOf(served.plugin)
    this.#servers = new Servers({ find: configuredServer, own: serverNameOf(served.plugin) })
  }

  known(id: string): Live | undefined {
    return this.#live.get(id)
  }

  async open({ id, cwd }: { id: string; cwd: string }): Promise<Live> {
    const known = this.#live.get(id)
    if (known !== undefined) known.state.cwd = cwd
    const live = known ?? this.#started({ id, cwd })
    await live.opened
    return live
  }

  close(): void {
    for (const { repeats } of this.#live.values()) {
      for (const repeat of repeats) clearInterval(repeat)
    }
    this.#servers.close()
  }

  #started({ id, cwd }: { id: string; cwd: string }): Live {
    const { plugin, mod } = this.#served
    const state: SessionState = { id, cwd, notes: [], context: [] }
    const path = join(this.#dir, 'settings.json')
    const settings = settingsFrom({ decls: this.#served.settings, text: readText(path), path })
    for (const problem of settings.problems) state.notes.push(`${plugin}: ${problem}`)
    const repeats: NodeJS.Timeout[] = []
    const runtime = settings.isOk ? new CodexRuntime({ mod, options: settings.options }) : undefined
    const opened = runtime?.open({ harness: this.#harnessFor(state), repeats }) ?? Promise.resolve()
    const live: Live = { state, runtime, opened, repeats }
    this.#live.set(id, live)
    return live
  }

  #harnessFor(state: SessionState): CodexSession['harness'] {
    const report = reporterFor({
      plugin: this.#served.plugin,
      session: state,
      log: (line) => {
        process.stderr.write(`${line}\n`)
      },
    })
    const store = fileStore({ dir: join(this.#dir, 'sessions'), session: state.id, report })
    return harnessFor({ session: state, servers: this.#servers, store, report })
  }
}
