/**
 * The dekit that `modkit dev` runs its tasks in, driven through dekit's CLI.
 *
 * A project's tasks belong to a runner of its own, which outlives the terminal that started it,
 * and the CLI and the TUI reach it over a socket. The runner's tasks inherit the environment it
 * started in. `dekit down`, and saving on quit, keeps the tasks for the next start, which then
 * brings back those rather than what `dekit.yaml` lists.
 *
 * @module
 */

import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { promisify } from 'node:util'

import * as v from 'valibot'

import type { Env } from '@atuin/modkit-target'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

// The npm shim of dekit, which runs the prebuilt binary its package installed for this platform.
const SHIM = createRequire(import.meta.url).resolve('@dekit/cli/bin/dekit.js')

const JSON_INDENT_SPACES = 2

const RunnerStatus = v.object({ status: v.string() })

const TaskList = v.object({ tasks: v.array(v.object({ path: v.string(), state: v.string() })) })

// What `dekit ls` calls a task whose process runs; `idle`, `exited` and `done` are the rest.
const UP_STATES: ReadonlySet<string> = new Set(['starting', 'ready', 'running'])

/** A task of a project's `dekit.yaml`. */
export interface DekitTask {
  /** Where the task sits, `claude-code`, which the CLI names it by. */
  path: string
  /** What the sidebar shows for it. */
  label: string
  /** The program and its arguments, run as written. */
  cmd: readonly string[]
  cwd: string
  /** Variables set over the runner's environment. */
  env: Readonly<Record<string, string>>
  /** Whether the runner starts it as it starts. */
  autostart: boolean
}

/** The dekit project at `root`, whose `dekit.yaml` lists the tasks `modkit dev` runs. */
export class Dekit {
  readonly #root: string
  readonly #env: Env

  constructor({ root, env }: { root: string; env: Env }) {
    this.#root = root
    this.#env = env
  }

  /** The project's directory, which holds its `dekit.yaml`. */
  get root(): string {
    return this.#root
  }

  /** The `dekit.yaml` that lists `tasks`, written as JSON, which YAML reads as it is. */
  static configOf(tasks: readonly DekitTask[]): string {
    const entries = tasks.map(({ path, ...task }): [string, Omit<DekitTask, 'path'>] => [
      path,
      task,
    ])
    return `${JSON.stringify({ tasks: Object.fromEntries(entries) }, null, JSON_INDENT_SPACES)}\n`
  }

  /** Write the project's `dekit.yaml`, which a runner reads as it starts. */
  async configure(config: string): Promise<void> {
    await writeFile(this.#config, config)
  }

  /** Whether the project's runner runs. */
  async isRunning(): Promise<boolean> {
    const status = v.parse(
      RunnerStatus,
      JSON.parse(await this.#run(['runner', 'status', '--json'])),
    )
    return status.status === 'running'
  }

  /** Drop the tasks a quit kept, so that the runner's next start reads `dekit.yaml`. */
  async forgetSaved(): Promise<void> {
    await this.#run(['runner', 'start'])
    await this.#run(['runner', 'stop'])
  }

  /** Restart the task at `path`, which starts it when it isn't running. */
  async restart(path: string): Promise<void> {
    await this.#run(['restart', path])
  }

  /** Whether the process of the task at `path` runs. */
  async isUp(path: string): Promise<boolean> {
    const list = v.parse(TaskList, JSON.parse(await this.#run(['ls', '--json'])))
    const task = list.tasks.find((one) => one.path === path)
    return task !== undefined && UP_STATES.has(task.state)
  }

  /**
   * Show the project's tasks in this terminal, starting the runner and its autostart tasks when
   * it isn't running, until the user quits or detaches; returns dekit's exit code.
   */
  async attach(): Promise<number> {
    const child = spawn(process.execPath, [SHIM, '-C', this.#root], {
      stdio: 'inherit',
      env: this.#env,
    })
    const exited: unknown[] = await once(child, 'exit')
    const [code] = exited
    return typeof code === 'number' ? code : 1
  }

  get #config(): string {
    return join(this.#root, 'dekit.yaml')
  }

  async #run(args: readonly string[]): Promise<string> {
    const argv = [SHIM, '-C', this.#root, ...args]
    const { stdout } = await execFileAsync(process.execPath, argv, {
      encoding: 'utf8',
      env: this.#env,
    })
    return stdout
  }
}
