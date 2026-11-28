/**
 * A target's harness as `modkit dev`'s `modkit-logs` task drives it: the dekit task that runs it,
 * and the build it last landed there, which it records for that task to start on
 * ({@link Landed}).
 *
 * @module
 */

import { randomUUID } from 'node:crypto'

import { errorMessage, type DevHarness, type Env } from '@atuin/modkit-target'

import type { TargetBuild } from './build.ts'
import type { Dekit } from './dekit.ts'
import { clock, digestOf, Landed } from './landed.ts'
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
    const digest = await digestOf({ dir: out, skipped: harness.writes })
    const way = await this.#wayOnto({ harness, digest })
    if (way === 'kept') return
    if (way === 'started') await harness.built()
    const session = this.#session
    const landed = new Landed({ digest, plugin, hasStatus, session, at: new Date() })
    // The harness's task reads the record as it starts, so it is written before the restart.
    await this.#place.land(landed)
    this.#loaded = landed
    if (way === 'started') await this.#dekit.restart(this.#place.slug)
    console.log(`${this.name}: ${way} on the ${clock(landed.at)} build`)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      await this.#harness?.dev[Symbol.asyncDispose]()
    } catch (error) {
      throw new Error(`${this.name}: ${errorMessage(error)}`, { cause: error })
    }
  }

  #failed(): void {
    const loaded = this.#loaded
    const on = loaded === undefined ? 'none to start on yet' : `still on the ${clock(loaded.at)}`
    console.error(`${this.name}: build failed; ${on}`)
  }

  // The harness readied for the build's plugin. A mod renamed in its package.json builds under a
  // new name, so the harness readied under the old one is closed, and the new one starts afresh.
  async #harnessFor({
    target,
    out,
    plugin,
    hasStatus,
  }: Extract<TargetBuild, { isOk: true }>): Promise<DevHarness> {
    if (this.#harness?.plugin === plugin) return this.#harness.dev
    await this.#harness?.dev[Symbol.asyncDispose]()
    const dev = target.dev({ out, plugin, hasStatus, scratch: this.#place.scratch, env: this.#env })
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
