import { join } from 'node:path'

import { NodeHarness } from '@atuin/modkit-target-node/runtime/harness'
import type { Servers } from '@atuin/modkit-target-node/runtime/servers'
import type { SettingsSchema } from '@atuin/modkit-target-node/runtime/settings'
import { FileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  failureReporter,
  type HarnessAdapter,
  type Images,
  type Mod,
  type Options,
} from '@atuin/modkit-target/host'

import type { Delivered } from '../protocol.ts'
import { CodexRuntime } from './runtime.ts'

const NO_MODEL = "Codex gives a plugin's MCP server no model to call"

interface SessionState {
  readonly id: string
  cwd: string
  notes: string[]
  context: string[]
}

export class LiveSession implements Disposable {
  readonly #state: SessionState
  readonly #runtime: CodexRuntime | undefined
  readonly #store: FileStore | undefined
  readonly #opened: Promise<void>

  private constructor({
    state,
    runtime,
    store,
    opened,
  }: {
    state: SessionState
    runtime: CodexRuntime | undefined
    store: FileStore | undefined
    opened: Promise<void>
  }) {
    this.#state = state
    this.#runtime = runtime
    this.#store = store
    this.#opened = opened
  }

  static start({
    id,
    cwd,
    dir,
    plugin,
    mod,
    images,
    stateTags,
    settingsSchema,
    servers,
  }: {
    id: string
    cwd: string
    dir: string
    plugin: string
    mod: Mod<Options>
    images: Images
    stateTags: Tags
    settingsSchema: SettingsSchema
    servers: Servers
  }): LiveSession {
    const state: SessionState = { id, cwd, notes: [], context: [] }
    const settings = settingsSchema.loadFile(join(dir, 'settings.json'))
    for (const problem of settings.problems) state.notes.push(`${plugin}: ${problem}`)
    if (!settings.isOk) {
      return new LiveSession({
        state,
        runtime: undefined,
        store: undefined,
        opened: Promise.resolve(),
      })
    }
    const { harness, store } = LiveSession.#buildHarness({
      state,
      dir,
      plugin,
      stateTags,
      servers,
    })
    const runtime = new CodexRuntime({ mod, options: settings.options, images })
    return new LiveSession({ state, runtime, store, opened: runtime.open({ harness }) })
  }

  static #buildHarness({
    state,
    dir,
    plugin,
    stateTags,
    servers,
  }: {
    state: SessionState
    dir: string
    plugin: string
    stateTags: Tags
    servers: Servers
  }): { harness: HarnessAdapter; store: FileStore } {
    const report = failureReporter({
      plugin,
      notify: (line) => {
        state.notes.push(line)
      },
      log: (line) => {
        process.stderr.write(`${line}\n`)
      },
    })
    const store = FileStore.open({
      dir: join(dir, 'sessions'),
      session: state.id,
      tags: stateTags,
      report,
    })
    const harness = NodeHarness.builder({
      sessionId: state.id,
      cwd: () => state.cwd,
      servers,
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
    return { harness, store }
  }

  get runtime(): CodexRuntime | undefined {
    return this.#runtime
  }

  get opened(): Promise<void> {
    return this.#opened
  }

  updateCwd(cwd: string): void {
    this.#state.cwd = cwd
  }

  queueNote(note: string): void {
    this.#state.notes.push(note)
  }

  drain(carriesContext: boolean): Delivered {
    return {
      notes: this.#state.notes.splice(0),
      context: carriesContext ? this.#state.context.splice(0) : [],
    }
  }

  [Symbol.dispose](): void {
    this.#store?.[Symbol.dispose]()
    this.#runtime?.[Symbol.dispose]()
  }
}
