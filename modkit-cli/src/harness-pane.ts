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
  /** The directory the build is in, which later builds write over. */
  out: string
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
      this.#loaded = { out, digest, at: new Date(), how: 'reloaded' }
      return this.label(loadedText(this.#loaded))
    }
    return this.#start({ harness: this.#harness, out, digest })
  }

  /**
   * Start the harness again on the build it last loaded, if it has loaded one and it is still whole.
   *
   * A build writes over the last one file by file, so this must not run while one does; one that
   * failed partway leaves no whole build, which the pane's border then says.
   */
  async restart(): Promise<void> {
    const harness = this.#harness
    const loaded = this.#loaded
    if (harness === undefined || loaded === undefined) return
    const digest = await digestOf({ dir: loaded.out, skipped: harness.writes ?? [] })
    if (digest !== loaded.digest) {
      return this.label(`not restarted: a later build wrote over the ${clock(loaded.at)} one`)
    }
    await this.#start({ harness, out: loaded.out, digest })
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

  async #start({
    harness,
    out,
    digest,
  }: {
    harness: DevHarness
    out: string
    digest: string
  }): Promise<void> {
    const command = harness.command(this.#session)
    // A pane starts in the tmux server's environment, which needn't be the one `modkit dev` was
    // started in, so that one is set over it.
    const at = { cwd: this.#cwd, env: { ...this.#env, ...command.env } }
    if (!isOnPath({ program: command.program, env: this.#env })) {
      const missing = `${command.program} is not on PATH, so ${this.#name} gets no harness`
      await this.#pane.respawn({ command: { program: 'echo', args: [missing], env: {} }, ...at })
      return this.label(`${command.program} is not on PATH`)
    }
    await harness.built?.()
    await this.#pane.respawn({ command, ...at })
    this.#session = { ...this.#session, hasStarted: true }
    this.#loaded = { out, digest, at: new Date(), how: 'started' }
    return this.label(loadedText(this.#loaded))
  }
}
