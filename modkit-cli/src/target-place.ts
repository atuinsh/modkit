/**
 * A target's place in `modkit dev`'s dekit project: the name its task and files go by, the
 * directory its harness keeps files in, and the record of the build it last landed.
 *
 * @module
 */

import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readIfAny } from './files.ts'
import { Landed } from './landed.ts'

// What a target's name holds that a dekit task's path can't, which takes letters, digits, `-`, `.`
// and `_`: each escaped as `_` and its code in hex, as a bare name holds no `_` to mistake for one.
const ESCAPES: Readonly<Record<string, string>> = { '@': '_40', '/': '_2F', _: '_5F', '~': '_7E' }

/** Where the target `name` keeps what its harness needs in the dekit project's directory. */
export class TargetPlace {
  /** The target's name as the mod lists it, `@acme/modkit-custom`. */
  readonly name: string
  /**
   * What the target goes by as a dekit task's path and in file names: `_40acme_2Fmodkit-custom`,
   * and a bare name, `claude-code`, as it is.
   */
  readonly slug: string
  /** A directory the target's harness may keep files in while `modkit dev` runs. */
  readonly scratch: string
  readonly #record: string

  constructor({ root, name }: { root: string; name: string }) {
    this.name = name
    this.slug = name.replaceAll(/[@/_~]/gu, (char) => ESCAPES[char] ?? char)
    this.scratch = join(root, this.slug)
    this.#record = join(root, `${this.slug}.landed.json`)
  }

  /** The build the target's harness last landed on, if it has landed one. */
  async landed(): Promise<Landed | undefined> {
    const text = await readIfAny(this.#record)
    return text === undefined ? undefined : Landed.parse(text)
  }

  /** Record `landed` as the build the harness is on, for its task to start on. */
  async land(landed: Landed): Promise<void> {
    await writeFile(this.#record, landed.toString())
  }

  /** Forget the build the harness last landed on. */
  async clear(): Promise<void> {
    await rm(this.#record, { force: true })
  }
}
