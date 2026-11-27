/**
 * A pane of the `modkit dev` window running one target's harness, which it brings onto each new
 * build of the target.
 *
 * @module
 */

import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { delimiter, join, relative } from 'node:path'

import type { DevHarness, DevSession, Env } from '@atuin/modkit-target'

import type { TargetBuild } from './build.ts'
import type { Pane } from './tmux.ts'

const clock = (at: Date): string => at.toLocaleTimeString('en-GB', { hour12: false })

/** A digest of every file under `dir` but those under `skipped`, by path and contents. */
async function digestOf({
  dir,
  skipped,
}: {
  dir: string
  skipped: readonly string[]
}): Promise<string> {
  const isSkipped = (path: string): boolean =>
    skipped.some((one) => path === one || path.startsWith(`${one}/`))
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((path) => !isSkipped(path))
    .toSorted()
  const contents = await Promise.all(files.map(async (file) => readFile(join(dir, file))))
  const hash = createHash('sha256')
  for (const [index, file] of files.entries()) {
    hash.update(`${file}\0`)
    hash.update(contents[index] ?? '')
  }
  return hash.digest('hex')
}

function isOnPath({ program, env }: { program: string; env: Env }): boolean {
  return (env['PATH'] ?? '').split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, program), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

/** What a pane's harness last loaded, and when and how it came onto it. */
interface Loaded {
  digest: string
  at: Date
  how: 'started' | 'reloaded'
}

const loadedText = ({ how, at }: Loaded): string => `${how} ${clock(at)}`

/** A pane running one target's harness, and what it last loaded. */
export class HarnessPane {
  readonly #pane: Pane
  readonly #name: string
  readonly #number: number
  readonly #cwd: string
  readonly #env: Env
  #session: DevSession = { id: randomUUID(), hasStarted: false }
  #harness: DevHarness | undefined
  #loaded: Loaded | undefined

  constructor({
    pane,
    name,
    number,
    cwd,
    env,
  }: {
    pane: Pane
    name: string
    number: number
    cwd: string
    env: Env
  }) {
    this.#pane = pane
    this.#name = name
    this.#number = number
    this.#cwd = cwd
    this.#env = env
  }

  get name(): string {
    return this.#name
  }

  get number(): number {
    return this.#number
  }

  /** Bring the harness onto `build`, which is of this pane's target, and keep it on its last. */
  async land({ build, scratch }: { build: TargetBuild; scratch: string }): Promise<void> {
    if (!build.isOk) {
      const on = this.#loaded === undefined ? '' : `; on the ${clock(this.#loaded.at)} build`
      return this.label(`build failed${on}`)
    }
    const { target, out, plugin } = build
    this.#harness ??= target.dev({ out, plugin, scratch, env: this.#env })
    const digest = await digestOf({ dir: out, skipped: this.#harness.writes ?? [] })
    // A harness that exited is started again on any build.
    const loaded = (await this.#pane.isDead()) ? undefined : this.#loaded
    if (digest === loaded?.digest) return this.label(loadedText(loaded))
    if (loaded !== undefined && this.#harness.reload === 'watched') {
      this.#loaded = { digest, at: new Date(), how: 'reloaded' }
      return this.label(loadedText(this.#loaded))
    }
    return this.#start({ harness: this.#harness, digest })
  }

  /** Start the harness again on the build it last loaded, if it has loaded one. */
  async restart(): Promise<void> {
    if (this.#harness === undefined || this.#loaded === undefined) return
    await this.#start({ harness: this.#harness, digest: this.#loaded.digest })
  }

  async sendLine(text: string): Promise<void> {
    await this.#pane.sendLine(text)
  }

  /** Undo what readying the harness for its builds changed. */
  async close(): Promise<void> {
    await this.#harness?.close?.()
  }

  async label(state: string): Promise<void> {
    await this.#pane.label(`${this.#number} ${this.#name} · ${state}`)
  }

  async #start({ harness, digest }: { harness: DevHarness; digest: string }): Promise<void> {
    const command = harness.command(this.#session)
    if (!isOnPath({ program: command.program, env: this.#env })) {
      const missing = `${command.program} is not on PATH, so ${this.#name} gets no harness`
      await this.#pane.respawn({
        command: { program: 'echo', args: [missing], env: {} },
        ...this.#at,
      })
      return this.label(`${command.program} is not on PATH`)
    }
    await harness.built?.()
    const env = { ...this.#at.env, ...command.env }
    await this.#pane.respawn({ command, cwd: this.#cwd, env })
    this.#session = { ...this.#session, hasStarted: true }
    this.#loaded = { digest, at: new Date(), how: 'started' }
    return this.label(loadedText(this.#loaded))
  }

  // Where a harness runs. A pane starts with the tmux server's environment, which needn't be
  // the one `modkit dev` was started in, so the programs it finds on PATH are passed on.
  get #at(): { cwd: string; env: Readonly<Record<string, string>> } {
    const path = this.#env['PATH']
    return { cwd: this.#cwd, env: path === undefined ? {} : { PATH: path } }
  }
}
