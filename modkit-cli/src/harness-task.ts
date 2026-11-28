/**
 * A target's harness as `modkit dev`'s `modkit-logs` task drives it: the dekit task that runs it,
 * and the build it last landed there, which it records for that task to start on
 * ({@link Landed}).
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { DevHarness, Env } from '@atuin/modkit-target'

import type { TargetBuild } from './build.ts'
import type { Dekit } from './dekit.ts'
import { clock, digestOf, Landed, slugOf } from './landed.ts'

/** How a harness comes onto a build: not at all, by loading it itself, or by a restart. */
type Way = 'kept' | 'reloaded' | 'started'

/** A target's harness: the dekit task it runs in, and the build it last landed there. */
export class HarnessTask {
  readonly #name: string
  readonly #dekit: Dekit
  readonly #env: Env
  readonly #session = randomUUID()
  #harness: { dev: DevHarness; plugin: string } | undefined
  #loaded: Landed | undefined

  constructor({ name, dekit, env }: { name: string; dekit: Dekit; env: Env }) {
    this.#name = name
    this.#dekit = dekit
    this.#env = env
  }

  get name(): string {
    return this.#name
  }

  /** Bring the harness onto `build`, which is of this task's target, and keep it on its last. */
  async land(build: TargetBuild): Promise<void> {
    if (!build.isOk) {
      this.#failed()
      return
    }
    const { out, plugin, hasStatus } = build
    const harness = await this.#harnessFor(build)
    const digest = await digestOf({ dir: out, skipped: harness.writes ?? [] })
    const way = await this.#wayOnto({ harness, digest })
    if (way === 'kept') return
    if (way === 'started') await harness.built?.()
    const session = this.#session
    const landed = new Landed({ digest, plugin, hasStatus, session, at: new Date() })
    // The harness's task reads the record as it starts, so it is written before the restart.
    await landed.write(Landed.pathOf({ dev: this.#dekit.root, name: this.#name }))
    this.#loaded = landed
    if (way === 'started') await this.#dekit.restart(slugOf(this.#name))
    console.log(`${this.#name}: ${way} on the ${clock(landed.at)} build`)
  }

  /** Undo what readying the harness for its builds changed. */
  async close(): Promise<void> {
    await this.#harness?.dev.close?.()
  }

  #failed(): void {
    const loaded = this.#loaded
    const on = loaded === undefined ? 'none to start on yet' : `still on the ${clock(loaded.at)}`
    console.error(`${this.#name}: build failed; ${on}`)
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
    await this.#harness?.dev.close?.()
    const dev = target.dev({ out, plugin, hasStatus, scratch: this.#scratch, env: this.#env })
    this.#harness = { dev, plugin }
    this.#loaded = undefined
    return dev
  }

  async #wayOnto({ harness, digest }: { harness: DevHarness; digest: string }): Promise<Way> {
    // A harness that exited is started again on any build.
    const loaded = (await this.#dekit.isUp(slugOf(this.#name))) ? this.#loaded : undefined
    if (loaded === undefined) return 'started'
    if (digest === loaded.digest) return 'kept'
    return harness.reload === 'watched' ? 'reloaded' : 'started'
  }

  get #scratch(): string {
    return join(this.#dekit.root, slugOf(this.#name))
  }
}
