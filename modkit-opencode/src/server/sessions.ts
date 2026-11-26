import { join } from 'node:path'

import { fileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import type { Ask, Failure, Mod, Options } from '@atuin/modkit-target/host'

import { harnessFor, type Reached } from './harness'
import { OpencodeRuntime, type OpencodeSession } from './runtime'

export interface Live {
  readonly runtime: OpencodeRuntime
  readonly session: OpencodeSession
  readonly opened: Promise<void>
  readonly asks: Map<string, Ask>
}

export interface Ports {
  reached: Reached
  dir: string
  tags: Tags
  changed: (id: string) => void
  notified: (notice: { id: string; text: string }) => void
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class Sessions {
  readonly #mod: Mod<Options>
  readonly #options: Options | undefined
  readonly #problems: readonly string[]
  readonly #ports: Ports
  readonly #live = new Map<string, Live>()
  readonly #seen = new Set<string>()

  constructor({
    mod,
    options,
    problems,
    ports,
  }: {
    mod: Mod<Options>
    options: Options | undefined
    problems: readonly string[]
    ports: Ports
  }) {
    this.#mod = mod
    this.#options = options
    this.#problems = problems
    this.#ports = ports
  }

  get cwd(): string {
    return this.#ports.reached.cwd
  }

  notify({ id, text }: { id: string; text: string }): void {
    this.#ports.notified({ id, text })
  }

  async live(id: string): Promise<Live | undefined> {
    if (id === '') return undefined
    const live = this.#live.get(id) ?? this.#started(id)
    await live?.opened
    return live
  }

  all(): Live[] {
    return [...this.#live.values()]
  }

  dispose(): void {
    for (const { session } of this.#live.values()) {
      for (const repeat of session.repeats) clearInterval(repeat)
    }
  }

  #started(id: string): Live | undefined {
    if (!this.#seen.has(id)) {
      this.#seen.add(id)
      for (const text of this.#problems) this.notify({ id, text })
    }
    const options = this.#options
    if (options === undefined) return undefined
    const runtime = new OpencodeRuntime({ mod: this.#mod, options })
    const session: OpencodeSession = {
      harness: this.#harnessFor(id),
      changed: () => {
        this.#ports.changed(id)
      },
      repeats: [],
    }
    const live: Live = { runtime, session, opened: runtime.open(session), asks: new Map() }
    this.#live.set(id, live)
    return live
  }

  #harnessFor(id: string): OpencodeSession['harness'] {
    const { reached, dir, tags } = this.#ports
    const told = new Set<string>()
    const report = ({ phase, error }: Failure): void => {
      const text = `${reached.plugin}: ${phase} failed: ${messageOf(error)}`
      if (told.has(text)) return
      told.add(text)
      this.notify({ id, text })
    }
    return harnessFor({
      reached,
      id,
      store: fileStore({ dir, session: id, tags, report }),
      notify: (text) => {
        this.notify({ id, text })
      },
      report,
    })
  }
}

export const sessionsDirOf = ({ data, plugin }: { data: string; plugin: string }): string =>
  join(data, 'opencode', 'modkit', plugin, 'sessions')
