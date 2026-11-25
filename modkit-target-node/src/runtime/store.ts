import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { isPlainObject } from 'es-toolkit/predicate'

import type { Failure, Store, Stored } from '@atuin/modkit-target/host'

const fileNameOf = (id: string): string => `${id.replaceAll(/[^A-Za-z0-9_-]/gu, '_')}.json`

export type Tags = Readonly<Record<string, string>>

// What a file holds of each key whose value still has the shape the mod declares for it: one
// kept under another tag is of a type the mod has since changed.
function storedIn({ path, tags }: { path: string; tags: Tags }): Map<string, Stored> {
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

export function fileStore({
  dir,
  session,
  tags,
  report,
}: {
  dir: string
  session: string
  tags: Tags
  report: (failure: Failure) => void
}): Store {
  const path = join(dir, fileNameOf(session))
  const stored = storedIn({ path, tags })
  const tagged = (): Record<string, unknown> =>
    Object.fromEntries([...stored].map(([key, { value }]) => [key, { tag: tags[key], value }]))
  return {
    get: (key) => stored.get(key),
    set: (key, value) => {
      stored.set(key, value)
      try {
        mkdirSync(dir, { recursive: true })
        // Written beside and renamed over, so a crash mid-write leaves the last whole file.
        writeFileSync(`${path}.tmp`, JSON.stringify(tagged()))
        renameSync(`${path}.tmp`, path)
      } catch (error) {
        report({ phase: 'render', error })
      }
    },
  }
}
