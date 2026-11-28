/**
 * The `modkit` task of `modkit dev`'s dekit project, which builds the mod on every save and brings
 * each harness's task onto its target's build.
 *
 * Claude Code reloads its build itself; the rest are restarted onto theirs on the session they
 * were on. A harness whose build failed keeps running the last one. When dekit stops the task, as
 * it does on quit, it undoes what the harnesses registered before it exits.
 *
 * @module
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { errorMessage, type Env } from '@atuin/modkit-target'

import type { Build, TargetBuild } from './build.ts'
import type { Dekit } from './dekit.ts'
import { HarnessTask } from './harness-task.ts'

/** What a workspace runs on. */
export interface WorkspaceInput {
  build: Build
  dekit: Dekit
  /** The targets that get a harness, which the mod's package.json lists. */
  names: readonly string[]
  /** The environment the harnesses start in. */
  env: Env
}

/** The `modkit` task: the build on every save, and each harness's task brought onto it. */
export class Workspace {
  readonly #input: WorkspaceInput
  readonly #tasks: readonly HarnessTask[]
  #queue: Promise<unknown> = Promise.resolve()
  #closing: Promise<never> | undefined

  constructor(input: WorkspaceInput) {
    this.#input = input
    const { dekit, env } = input
    this.#tasks = input.names.map((name) => new HarnessTask({ name, dekit, env }))
  }

  /** Build the mod on every save, bringing the harnesses onto each build. */
  async run(): Promise<void> {
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void this.close()
      })
    }
    await this.#input.build.watch(async (build) =>
      this.#serial(async () => this.#landed(await build())),
    )
  }

  /** Where a quit that left something to undo says what, in the dekit project's `root`. */
  static unclosedPathOf(root: string): string {
    return join(root, 'unclosed.txt')
  }

  /**
   * Undo what the harnesses registered, then exit.
   *
   * A harness that fails to undo it exits non-zero, saying why in {@link Workspace.unclosedPathOf}.
   */
  async close(): Promise<never> {
    this.#closing ??= this.#closed()
    return this.#closing
  }

  async #closed(): Promise<never> {
    // A step under way may be registering what closing the harnesses undoes, so it finishes
    // first; `#serial` starts none once closing has begun.
    await this.#queue
    const failures = await Promise.all(
      this.#tasks.map(async (task): Promise<string[]> => {
        try {
          await task.close()
          return []
        } catch (error) {
          return [`${task.name}: ${errorMessage(error)}`]
        }
      }),
    )
    const failed = failures.flat()
    if (failed.length === 0) process.exit(0)
    const report = [...failed, 'modkit dev quit, but the above is still to undo by hand'].join('\n')
    console.error(report)
    // This task's screen goes with dekit as it quits, so `modkit dev` prints the report after.
    await writeFile(Workspace.unclosedPathOf(this.#input.dekit.root), `${report}\n`)
    process.exit(1)
  }

  // Runs `step` once every step before it has finished, so a harness is never brought onto a
  // build while the next is being written; drops it once closing.
  async #serial(step: () => Promise<unknown>): Promise<void> {
    if (this.#closing !== undefined) return
    const next = this.#queue.then(step)
    this.#queue = next.catch((error: unknown) => {
      console.error(errorMessage(error))
    })
    await this.#queue
  }

  async #landed(builds: readonly TargetBuild[]): Promise<void> {
    await Promise.all(
      this.#tasks.map(async (task) => {
        const build = builds.find((one) => one.target.name === task.name)
        if (build === undefined) return
        await task.land(build).catch((error: unknown) => {
          console.error(`${task.name}: ${errorMessage(error)}`)
        })
      }),
    )
  }
}
