import { join } from 'node:path'

import { fileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  failureReporter,
  type Ask,
  type Images,
  type Mod,
  type Options,
} from '@atuin/modkit-target/host'

import { buildHarness, type Reached } from './harness'
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

export class Sessions implements Disposable {
  readonly #mod: Mod<Options>
  readonly #images: Images
  readonly #options: Options | undefined
  readonly #problems: readonly string[]
  readonly #ports: Ports
  readonly #live = new Map<string, Live>()
  readonly #seen = new Set<string>()

  constructor({
    mod,
    images,
    options,
    problems,
    ports,
  }: {
    mod: Mod<Options>
    images: Images
    options: Options | undefined
    problems: readonly string[]
    ports: Ports
  }) {
    this.#mod = mod
    this.#images = images
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

  [Symbol.dispose](): void {
    for (const { runtime } of this.#live.values()) runtime[Symbol.dispose]()
  }

  #started(id: string): Live | undefined {
    if (!this.#seen.has(id)) {
      this.#seen.add(id)
      for (const text of this.#problems) this.notify({ id, text })
    }
    const options = this.#options
    if (options === undefined) return undefined
    const runtime = new OpencodeRuntime({ mod: this.#mod, options, images: this.#images })
    const session: OpencodeSession = {
      harness: this.#harnessFor(id),
      changed: () => {
        this.#ports.changed(id)
      },
    }
    const live: Live = { runtime, session, opened: runtime.open(session), asks: new Map() }
    this.#live.set(id, live)
    return live
  }

  #harnessFor(id: string): OpencodeSession['harness'] {
    const { reached, dir, tags } = this.#ports
    const report = failureReporter({
      plugin: reached.plugin,
      notify: (text) => {
        this.notify({ id, text })
      },
    })
    return buildHarness({
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
