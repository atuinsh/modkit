/**
 * What a `modkit dev` run asks for, which it keeps in its {@link DevLayout}: its tasks, and a run
 * after it on the same mod, read the request there rather than parse it back out of arguments.
 *
 * @module
 */

import * as v from 'valibot'

import { Result } from '@atuin/modkit-target'

import type { Build } from './build.ts'

const JSON_INDENT_SPACES = 2

const RequestRecord = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ dir: v.string(), out: v.string(), cwd: v.string(), targets: v.array(v.string()) }),
)

/** The mod a `modkit dev` run builds and where, where its harnesses start, and for which targets. */
export class DevRequest {
  /** The mod's package directory. */
  readonly dir: string
  /** The base directory each target's build goes under. */
  readonly out: string
  /** The directory the harnesses start in. */
  readonly cwd: string
  /** The targets that get a harness, as the mod lists them. */
  readonly targets: readonly string[]

  private constructor({
    dir,
    out,
    cwd,
    targets,
  }: {
    dir: string
    out: string
    cwd: string
    targets: readonly string[]
  }) {
    this.dir = dir
    this.out = out
    this.cwd = cwd
    this.targets = targets
  }

  /**
   * The request to run `build`'s harnesses in `cwd`: for the targets the comma-separated `only`
   * names, or every one `listed` when it names none; why not, when it names one `listed` lacks.
   */
  static pick({
    build,
    cwd,
    only,
    listed,
  }: {
    build: Build
    cwd: string
    only: string | undefined
    listed: readonly string[]
  }): Result<DevRequest, string> {
    const targets =
      only === undefined
        ? listed
        : only
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== '')
    const unlisted = targets.filter((name) => !listed.includes(name))
    if (unlisted.length > 0) {
      const names = unlisted.join(', ')
      return Result.err(
        `--only names ${names}, which modkit.targets does not list (it lists ${listed.join(', ')})`,
      )
    }
    return Result.ok(new DevRequest({ dir: build.dir, out: build.out, cwd, targets }))
  }

  /** The request `text`, as {@link DevRequest.toString} writes it. */
  static parse(text: string): DevRequest {
    return new DevRequest(v.parse(RequestRecord, text))
  }

  /** The arguments, after the program's, that run `modkit dev` on the request's mod and out. */
  get args(): readonly string[] {
    return ['dev', this.dir, '--out', this.out]
  }

  /** The flags a run of the request is started with: `--out dist --cwd . --only pi,codex`. */
  get flags(): string {
    return `--out ${this.out} --cwd ${this.cwd} --only ${this.targets.join(',')}`
  }

  /** Whether `other` asks for what this one does. */
  equals(other: DevRequest): boolean {
    return this.toString() === other.toString()
  }

  /** The request as JSON, which {@link DevRequest.parse} reads. */
  toString(): string {
    const { dir, out, cwd, targets } = this
    return `${JSON.stringify({ dir, out, cwd, targets }, null, JSON_INDENT_SPACES)}\n`
  }
}
