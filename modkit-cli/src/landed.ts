/**
 * The record of the build `modkit dev`'s `modkit-logs` task last brought a harness onto, which the
 * harness's own task reads as it starts ({@link TargetPlace.landed}).
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import * as v from 'valibot'

const JSON_INDENT_SPACES = 2

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

const LandedRecord = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    digest: v.string(),
    plugin: v.string(),
    hasStatus: v.boolean(),
    session: v.string(),
    at: v.pipe(
      v.string(),
      v.isoTimestamp(),
      v.transform((at) => Temporal.Instant.from(at)),
    ),
  }),
)

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
  /** When it landed. */
  readonly at: Temporal.Instant

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
    at: Temporal.Instant
  }) {
    this.digest = digest
    this.plugin = plugin
    this.hasStatus = hasStatus
    this.session = session
    this.at = at
  }

  /** The time of day it landed, here, to the second: `14:46:37`. */
  get time(): string {
    const here = this.at.toZonedDateTimeISO(Temporal.Now.timeZoneId())
    return here.toPlainTime().toString({ smallestUnit: 'second' })
  }

  /** The record `text`, as {@link Landed.toString} writes it. */
  static parse(text: string): Landed {
    return new Landed(v.parse(LandedRecord, text))
  }

  /** The record as JSON, which {@link Landed.parse} reads. */
  toString(): string {
    const { digest, plugin, hasStatus, session } = this
    const record = { digest, plugin, hasStatus, session, at: this.at.toString() }
    return `${JSON.stringify(record, null, JSON_INDENT_SPACES)}\n`
  }
}
