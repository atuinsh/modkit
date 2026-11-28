/**
 * The record of the build `modkit dev`'s `modkit-logs` task last brought a harness onto, which the
 * harness's own task reads as it starts, `<target>.landed.json` in the dekit project's directory.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import * as v from 'valibot'

import { readIfAny } from './files.ts'

const JSON_INDENT_SPACES = 2

// What a target's name holds that a dekit task's path can't, which takes letters, digits, `-`, `.`
// and `_`: each escaped as `_` and its code in hex, as a bare name holds no `_` to mistake for one.
const ESCAPES: Readonly<Record<string, string>> = { '@': '_40', '/': '_2F', _: '_5F', '~': '_7E' }

/**
 * What the target `name` goes by in `modkit dev`'s dekit project, as a task's path and in its
 * file names: `_40acme_2Fmodkit-custom` for `@acme/modkit-custom`, and `claude-code` as it is.
 */
export const slugOf = (name: string): string =>
  name.replaceAll(/[@/_~]/gu, (char) => ESCAPES[char] ?? char)

/** The time of day `at` was, `14:46:37`. */
export const clock = (at: Date): string => at.toLocaleTimeString('en-GB', { hour12: false })

/** A digest of every file under `dir` but those under `skipped`, by path and contents. */
export async function digestOf({
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

const LandedRecord = v.object({
  digest: v.string(),
  plugin: v.string(),
  hasStatus: v.boolean(),
  session: v.string(),
  at: v.pipe(v.string(), v.isoTimestamp()),
})

/** The build the `modkit-logs` task last brought a harness onto. */
export class Landed {
  /** The {@link digestOf} the build's files, less those the harness writes itself. */
  readonly digest: string
  /** The harness's name for the package the build wrote, `atuin-mod`. */
  readonly plugin: string
  /** Whether the mod has a status. */
  readonly hasStatus: boolean
  /** The UUID of the session the harness runs on while `modkit dev` runs. */
  readonly session: string
  readonly at: Date

  constructor({
    digest,
    plugin,
    hasStatus,
    session,
    at,
  }: {
    digest: string
    plugin: string
    hasStatus: boolean
    session: string
    at: Date
  }) {
    this.digest = digest
    this.plugin = plugin
    this.hasStatus = hasStatus
    this.session = session
    this.at = at
  }

  /** Where the record for the target `name` is in `dev`, the dekit project's directory. */
  static pathOf({ dev, name }: { dev: string; name: string }): string {
    return join(dev, `${slugOf(name)}.landed.json`)
  }

  /** The record at `path`, if one was written. */
  static async read(path: string): Promise<Landed | undefined> {
    const text = await readIfAny(path)
    if (text === undefined) return undefined
    const record = v.parse(LandedRecord, JSON.parse(text))
    return new Landed({ ...record, at: new Date(record.at) })
  }

  async write(path: string): Promise<void> {
    const { digest, plugin, hasStatus, session } = this
    const record = { digest, plugin, hasStatus, session, at: this.at.toISOString() }
    await writeFile(path, `${JSON.stringify(record, null, JSON_INDENT_SPACES)}\n`)
  }
}
