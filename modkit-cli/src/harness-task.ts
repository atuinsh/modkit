/**
 * A target's harness in `modkit dev`: the dekit task that runs it, and the build it last landed.
 *
 * The `modkit-logs` task lands each build of the target ({@link HarnessTask.land}) and records it
 * in the target's place; the harness's own task reads that record as it starts
 * ({@link HarnessTask.exec}), so that a restart from dekit's keys starts on the build last landed,
 * on the same session, and on none that a later build has written over since.
 *
 * @module
 */

import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import which from 'which'

import {
  errorMessage,
  Result,
  type DevCommand,
  type DevHarness,
  type Env,
} from '@atuin/modkit-target'

import type { Build, TargetBuild } from './build.ts'
import { Dekit } from './dekit.ts'
import { Landed } from './landed.ts'
import type { DevLayout } from './layout.ts'
import type { TargetPlace } from './target-place.ts'

/** How a harness comes onto a build: not at all, by loading it itself, or by a restart. */
type Way = 'kept' | 'reloaded' | 'started'

/**
 * A target's harness: the dekit task it runs in, and the build it last landed there.
 *
 * Disposing it undoes what readying its harness for its builds changed, saying which target's
 * failed when that fails.
 */
export class HarnessTask implements AsyncDisposable {
  readonly #place: TargetPlace
  readonly #dekit: Dekit
  readonly #env: Env
  readonly #session = randomUUID()
  #harness: { dev: DevHarness; plugin: string } | undefined
  #loaded: Landed | undefined

  constructor({ place, dekit, env }: { place: TargetPlace; dekit: Dekit; env: Env }) {
    this.#place = place
    this.#dekit = dekit
    this.#env = env
  }

  /** The task of the target `name` in the dekit project `layout` holds, its harness run in `env`. */
  static in({ layout, name, env }: { layout: DevLayout; name: string; env: Env }): HarnessTask {
    const dekit = new Dekit({ root: layout.root, env })
    return new HarnessTask({ place: layout.target(name), dekit, env })
  }

  get name(): string {
    return this.#place.name
  }

  /** Bring the harness onto `build`, which is of this task's target, and keep it on its last. */
  async land(build: TargetBuild): Promise<void> {
    if (!build.isOk) {
      this.#failed()
      return
    }
    const { out, plugin, hasStatus } = build
    const harness = await this.#harnessFor(build)
    const digest = await HarnessTask.#digest({ out, harness })
    const way = await this.#wayOnto({ harness, digest })
    if (way === 'kept') return
    if (way === 'started') await harness.built()
    const session = this.#session
    const landed = new Landed({ digest, plugin, hasStatus, session, at: Temporal.Now.instant() })
    // The harness's task reads the record as it starts, so it is written before the restart.
    await this.#place.land(landed)
    this.#loaded = landed
    if (way === 'started') await this.#dekit.restart(this.#place.slug)
    console.log(`${this.name}: ${way} on the ${landed.time} build`)
  }

  /**
   * Replace this process with the harness, on the build of `build`'s mod the `modkit-logs` task
   * last landed for it; returns an exit code only when it doesn't start.
   *
   * The build is checked once, so a save landing between the check and the harness reading its
   * files can still start it on a mix: dekit's restart key is pressed by hand, which makes that
   * window rare, and the build that lands restarts the harness onto itself.
   */
  async exec(build: Build): Promise<number> {
    const command = await this.#command(build)
    if (!command.outcome.isOk) {
      console.error(command.outcome.error)
      return 1
    }
    const { program, args, env } = command.outcome.value
    const path = which.sync(program, { path: this.#env['PATH'] ?? '', nothrow: true })
    if (path === null) {
      console.error(`${program} is not on PATH, so ${this.name} gets no harness`)
      return 1
    }
    if (process.execve === undefined) {
      console.error(
        `${this.name}: modkit dev starts a harness in place of its own process, which ${process.platform} can't do`,
      )
      return 1
    }
    return process.execve(path, [program, ...args], { ...this.#env, ...env })
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await this.#harness?.dev[Symbol.asyncDispose]()
    } catch (error) {
      throw new Error(`${this.name}: ${errorMessage(error)}`, { cause: error })
    }
  }

  // The command that starts the harness on the build last landed for it, or why it doesn't start.
  async #command(build: Build): Promise<Result<DevCommand, string>> {
    const landed = await this.#place.landed()
    if (landed === undefined) return Result.err(`${this.name} starts once a build of it lands`)
    const listed = await build.listed()
    if (!listed.outcome.isOk) return Result.err(listed.outcome.error)
    const target = listed.outcome.value.find((one) => one.name === this.name)
    if (target === undefined) {
      return Result.err(`modkit.targets no longer lists ${this.name}, so it gets no harness`)
    }
    const out = build.targetOut(this.name)
    const { plugin, hasStatus } = landed
    const harness = target.dev({
      out,
      plugin,
      hasStatus,
      scratch: this.#place.scratch,
      env: this.#env,
    })
    const digest = await HarnessTask.#digest({ out, harness })
    if (digest !== landed.digest) {
      return Result.err(
        `${this.name}: not started, since a build that never landed wrote over the ${landed.time} one; the next build that does starts it`,
      )
    }
    return Result.ok(harness.command({ id: landed.session }))
  }

  // A digest of every file of the build in `out` but those `harness` writes itself, by path and
  // contents.
  static async #digest({ out, harness }: { out: string; harness: DevHarness }): Promise<string> {
    const isWritten = (path: string): boolean =>
      harness.writes.some((one) => path === one || path.startsWith(`${one}/`))
    const entries = await readdir(out, { recursive: true, withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(out, join(entry.parentPath, entry.name)))
      .filter((path) => !isWritten(path))
      .toSorted()
    const contents = await Promise.all(files.map(async (file) => readFile(join(out, file))))
    const hash = createHash('sha256')
    for (const [index, file] of files.entries()) {
      hash.update(`${file}\0`)
      hash.update(contents[index] ?? '')
    }
    return hash.digest('hex')
  }

  #failed(): void {
    const loaded = this.#loaded
    const on = loaded === undefined ? 'none to start on yet' : `still on the ${loaded.time}`
    console.error(`${this.name}: build failed; ${on}`)
  }

  // The harness readied for the build's plugin. A mod renamed in its package.json builds under a
  // new name, so the harness readied under the old one is disposed, and the new one starts afresh.
  async #harnessFor({
    target,
    out,
    plugin,
    hasStatus,
  }: Extract<TargetBuild, { isOk: true }>): Promise<DevHarness> {
    if (this.#harness?.plugin === plugin) return this.#harness.dev
    await this.#harness?.dev[Symbol.asyncDispose]()
    const { scratch } = this.#place
    const dev = target.dev({ out, plugin, hasStatus, scratch, env: this.#env })
    this.#harness = { dev, plugin }
    this.#loaded = undefined
    return dev
  }

  async #wayOnto({ harness, digest }: { harness: DevHarness; digest: string }): Promise<Way> {
    // A harness that exited is started again on any build.
    const loaded = (await this.#dekit.isUp(this.#place.slug)) ? this.#loaded : undefined
    if (loaded === undefined) return 'started'
    if (digest === loaded.digest) return 'kept'
    return harness.reload === 'watched' ? 'reloaded' : 'started'
  }
}
