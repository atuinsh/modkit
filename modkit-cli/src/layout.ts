/**
 * The directory `modkit dev` keeps a mod's dekit project in, `<out>/.dev/<the mod's directory
 * name>`, which dekit shows as the project's name, and what it keeps there beside `dekit.yaml`.
 *
 * @module
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { Build } from './build.ts'
import { readIfAny } from './files.ts'
import { DevRequest } from './request.ts'
import { TargetPlace } from './target-place.ts'

/** The dekit project's directory of a `modkit dev` run, and the files in it. */
export class DevLayout {
  /** The project's directory, which holds its `dekit.yaml`. */
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /** The layout of `modkit dev` runs of `build`'s mod into `build`'s out directory. */
  static for(build: Build): DevLayout {
    return new DevLayout(join(build.out, '.dev', basename(build.dir)))
  }

  /** What the run in the project asked for, if one has run in it. */
  async request(): Promise<DevRequest | undefined> {
    const text = await readIfAny(this.#request)
    return text === undefined ? undefined : DevRequest.parse(text)
  }

  /** Keep `request` as what the run in the project asks for, which its tasks read. */
  async keepRequest(request: DevRequest): Promise<void> {
    await writeFile(this.#request, request.toString())
  }

  /** Where the target `name` keeps what its harness needs. */
  target(name: string): TargetPlace {
    return new TargetPlace({ root: this.root, name })
  }

  /** Make the directory, which dekit takes only once it exists, even to say no runner runs there. */
  async make(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  /** Forget what a run before kept for `names`' harnesses, and any report of its quit. */
  async reset(names: readonly string[]): Promise<void> {
    await Promise.all(names.map(async (name) => this.target(name).clear()))
    await rm(this.#report, { force: true })
  }

  /**
   * Keep `report`, what a quit left to undo, for {@link DevLayout.takeReport}: the `modkit-logs`
   * task's screen goes with dekit as it quits.
   */
  async report(report: string): Promise<void> {
    await writeFile(this.#report, `${report}\n`)
  }

  /** The report a quit left, if it left one, which is then gone. */
  async takeReport(): Promise<string | undefined> {
    const report = await readIfAny(this.#report)
    await rm(this.#report, { force: true })
    return report
  }

  get #request(): string {
    return join(this.root, 'request.json')
  }

  get #report(): string {
    return join(this.root, 'unclosed.txt')
  }
}
