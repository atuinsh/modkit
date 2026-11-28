/**
 * The dekit project `modkit dev` opens from this terminal: a task per target its request picks,
 * each running its harness, then `modkit-logs`, which builds on every save.
 *
 * @module
 */

import { resolve } from 'node:path'

import type { Env, Result } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { Dekit, type DekitTask } from './dekit.ts'
import { DevLayout } from './layout.ts'
import { DevRequest } from './request.ts'
import { TaskEnv } from './task-env.ts'

/** What the `dev` command is run with. */
export interface DevArgs {
  dir: string | undefined
  out: string | undefined
  cwd: string | undefined
  only: string | undefined
}

// The path of the `modkit-logs` task, which no target's task can take: a bare target's name holds
// no `.`, and a scoped one's slug ({@link TargetPlace.slug}) starts with `_40`.
const LOGS_PATH = 'modkit.logs'

/** A mod's dekit project, as `modkit dev` run by hand opens it. */
export class DevProject {
  readonly #request: DevRequest
  readonly #layout: DevLayout
  readonly #dekit: Dekit

  private constructor({
    request,
    layout,
    dekit,
  }: {
    request: DevRequest
    layout: DevLayout
    dekit: Dekit
  }) {
    this.#request = request
    this.#layout = layout
    this.#dekit = dekit
  }

  /** The project `args` ask for, run in `env`, or why there is none. */
  static async for({
    args,
    env,
  }: {
    args: DevArgs
    env: Env
  }): Promise<Result<DevProject, string>> {
    const build = Build.of(args)
    const listed = await build.listed()
    return listed
      .andThen((targets) =>
        DevRequest.pick({
          build,
          cwd: resolve(args.cwd ?? '.'),
          only: args.only,
          listed: targets.map((target) => target.name),
        }),
      )
      .map((request) => {
        const layout = DevLayout.for(build)
        return new DevProject({ request, layout, dekit: new Dekit({ root: layout.root, env }) })
      })
  }

  /** Show the project in this terminal until it quits or is detached from; returns the exit code. */
  async open(): Promise<number> {
    if (!(await this.#readied())) return 1
    const code = await this.#dekit.attach()
    if (await this.#dekit.isRunning()) {
      console.log(
        'modkit dev runs on in the background; modkit dev with the same arguments gets back to it',
      )
      return code
    }
    // The `modkit-logs` task keeps what its quit failed to undo, as its screen goes with dekit.
    const unclosed = await this.#layout.takeReport()
    if (unclosed === undefined) return code
    process.stderr.write(unclosed)
    return 1
  }

  // Readies the project to attach to: written for a runner to start on, or, when one runs, asked
  // for as this run asks; false when it runs another request, saying so.
  async #readied(): Promise<boolean> {
    await this.#layout.make()
    if (!(await this.#dekit.isRunning())) {
      await this.#written()
      return true
    }
    // Attaching to the one running would leave this run's request unused.
    const running = await this.#layout.request()
    if (running?.equals(this.#request) === true) return true
    const { dir } = this.#request
    const flags = running?.flags ?? '<the arguments it runs with>'
    console.error(
      `modkit dev already runs ${dir} with ${flags}; modkit dev ${dir} ${flags} gets back to it, and q there quits it`,
    )
    return false
  }

  // Writes the project for a runner to start on: the request and the tasks, no record of a build
  // a harness landed, and no tasks a quit kept.
  async #written(): Promise<void> {
    const { targets } = this.#request
    await this.#layout.keepRequest(this.#request)
    await this.#dekit.configure(Dekit.configOf(this.#tasks))
    await this.#layout.reset(targets)
    await this.#dekit.forgetSaved()
  }

  // A harness's task per target, then `modkit-logs`, in the order the sidebar lists them. Each runs
  // this command again as it was run, under tsx or not, on the request's mod and out.
  get #tasks(): DekitTask[] {
    // This process's script, `src/main.ts`, after the runtime and its flags.
    const [, script] = process.argv
    const self = [process.execPath, ...process.execArgv, ...(script === undefined ? [] : [script])]
    const cmd = [...self, ...this.#request.args]
    const { cwd, targets } = this.#request
    const harnesses = targets.map((target) => ({
      path: this.#layout.target(target).slug,
      label: target,
      cmd,
      cwd,
      env: TaskEnv.varsFor({ kind: 'harness', target }),
      autostart: false,
    }))
    const logs = {
      path: LOGS_PATH,
      label: 'modkit-logs',
      cmd,
      cwd: process.cwd(),
      env: TaskEnv.varsFor({ kind: 'logs' }),
      autostart: true,
    }
    return [...harnesses, logs]
  }
}
