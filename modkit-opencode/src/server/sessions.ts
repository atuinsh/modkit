import { join } from 'node:path'

import { SessionPool } from '@atuin/modkit-target-node/runtime/session-pool'
import { FileStore, type Tags } from '@atuin/modkit-target-node/runtime/store'
import {
  FailureReporter,
  type Ask,
  type Images,
  type Mod,
  type Options,
} from '@atuin/modkit-target/host'

import { buildHarness, type Reached } from './harness.ts'
import { OpencodeRuntime, type OpencodeSession } from './runtime.ts'

export interface Live extends Disposable {
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
  readonly #pool = new SessionPool<Live>()
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

  static dir({ data, plugin }: { data: string; plugin: string }): string {
    return join(data, 'opencode', 'modkit', plugin, 'sessions')
  }

  get cwd(): string {
    return this.#ports.reached.cwd
  }

  notify({ id, text }: { id: string; text: string }): void {
    this.#ports.notified({ id, text })
  }

  async live(id: string): Promise<Live | undefined> {
    if (id === '') return undefined
    const existing = this.#pool.get(id)
    if (existing !== undefined) {
      await existing.opened
      return existing
    }
    const created = this.#start(id)
    await created?.opened
    return created
  }

  all(): Live[] {
    return this.#pool.values()
  }

  [Symbol.dispose](): void {
    this.#pool[Symbol.dispose]()
  }

  #start(id: string): Live | undefined {
    if (!this.#seen.has(id)) {
      this.#seen.add(id)
      for (const text of this.#problems) this.notify({ id, text })
    }
    const options = this.#options
    if (options === undefined) return undefined
    return this.#pool.getOrCreate(id, () => {
      const { reached, dir, tags } = this.#ports
      const { report } = FailureReporter.for({
        plugin: reached.plugin,
        notify: (text) => {
          this.notify({ id, text })
        },
      })
      const runtime = new OpencodeRuntime({ mod: this.#mod, options, images: this.#images })
      const session: OpencodeSession = {
        buildHarness: (signal) => {
          const store = FileStore.open({ dir, session: id, tags, report })
          const harness = buildHarness({
            reached,
            id,
            store,
            notify: (text) => {
              this.notify({ id, text })
            },
            report,
            signal,
          })
          return { harness, store }
        },
        changed: () => {
          this.#ports.changed(id)
        },
      }
      return {
        runtime,
        session,
        opened: runtime.open(session),
        asks: new Map(),
        [Symbol.dispose]: () => {
          runtime[Symbol.dispose]()
        },
      }
    })
  }
}
