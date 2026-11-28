import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isPlainObject } from 'es-toolkit/predicate'

import type { Failure, Store, Stored } from '@atuin/modkit-target/host'

const fileNameOf = (id: string): string => `${id.replaceAll(/[^A-Za-z0-9_-]/gu, '_')}.json`

export type Tags = Readonly<Record<string, string>>

// What a file holds of each key whose value still has the shape the mod declares for it: one
// kept under another tag is of a type the mod has since changed.
function readStored({ path, tags }: { path: string; tags: Tags }): Map<string, Stored> {
  const stored = new Map<string, Stored>()
  try {
    const json: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isPlainObject(json)) return stored
    for (const [key, held] of Object.entries(json)) {
      const isCurrent = isPlainObject(held) && 'value' in held && held['tag'] === tags[key]
      if (isCurrent && tags[key] !== undefined) stored.set(key, { value: held['value'] })
    }
  } catch {
    // No file yet, or one that isn't JSON: the session starts from nothing, as a new one does.
  }
  return stored
}

/**
 * Schema-tagged JSON file store for one session.
 *
 * Disposing freezes writes so an in-flight async query that finishes after session teardown cannot
 * overwrite state saved by a subsequent runtime.
 */
export class FileStore implements Store, Disposable {
  readonly #dir: string
  readonly #path: string
  readonly #tags: Tags
  readonly #report: (failure: Failure) => void
  readonly #stored: Map<string, Stored>
  #isClosed = false

  private constructor({
    dir,
    path,
    tags,
    report,
    stored,
  }: {
    dir: string
    path: string
    tags: Tags
    report: (failure: Failure) => void
    stored: Map<string, Stored>
  }) {
    this.#dir = dir
    this.#path = path
    this.#tags = tags
    this.#report = report
    this.#stored = stored
  }

  /** Load or initialize a session's persisted state file under `dir`. */
  static open({
    dir,
    session,
    tags,
    report,
  }: {
    dir: string
    session: string
    tags: Tags
    report: (failure: Failure) => void
  }): FileStore {
    const path = join(dir, fileNameOf(session))
    return new FileStore({ dir, path, tags, report, stored: readStored({ path, tags }) })
  }

  get(key: string): Stored | undefined {
    return this.#stored.get(key)
  }

  set(key: string, value: Stored): void {
    if (this.#isClosed) return
    this.#stored.set(key, value)
    try {
      mkdirSync(this.#dir, { recursive: true })
      const tagged = Object.fromEntries(
        [...this.#stored].map(([name, held]) => [
          name,
          { tag: this.#tags[name], value: held.value },
        ]),
      )
      // Written beside and renamed over, so a crash mid-write leaves the last whole file.
      writeFileSync(`${this.#path}.tmp`, JSON.stringify(tagged))
      renameSync(`${this.#path}.tmp`, this.#path)
    } catch (error) {
      this.#report({ phase: 'render', error })
    }
  }

  [Symbol.dispose](): void {
    this.#isClosed = true
  }
}
