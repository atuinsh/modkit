/**
 * Filesystem helpers.
 *
 * @module
 */

import { readFile } from 'node:fs/promises'

/** The text of the file at `path`, if there is one. */
export async function readIfAny(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}
