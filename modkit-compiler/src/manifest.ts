/**
 * Reading and validating a mod package's `package.json` metadata.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import slugify from '@sindresorhus/slugify'
import * as v from 'valibot'

import { DiagnosticError } from './diagnostics.ts'
import type { Author, ModInfo } from './ir.ts'

// Maximum plugin name length enforced by Claude Code and kept consistent across targets.
const NAME_LENGTH = 64

const NonEmptyString = v.pipe(v.string(), v.nonEmpty())

const AuthorObjectSchema = v.object({
  name: NonEmptyString,
  email: v.fallback(v.optional(NonEmptyString), () => undefined),
  url: v.fallback(v.optional(NonEmptyString), () => undefined),
})

const ManifestSchema = v.object({
  name: NonEmptyString,
  version: NonEmptyString,
  description: NonEmptyString,
  author: v.optional(v.unknown()),
})

const AUTHOR_LINE = /^(?<name>[^<(]+?)\s*(?:<(?<email>[^>]+)>)?\s*(?:\((?<url>[^)]+)\))?$/u

/** Reader and validator bound to a mod directory's `package.json` and `tsconfig.json`. */
export class ModManifest {
  readonly #dir: string

  constructor(dir: string) {
    this.#dir = dir
  }

  /**
   * Parse an npm `package.json` `author` field into an {@link Author}.
   *
   * Accepts either a one-line string (`Name <email> (url)`, with email and url optional) or an
   * object with a non-empty `name` string. Returns `undefined` if `author` is missing or malformed.
   */
  static parseAuthor(author: unknown): Author | undefined {
    if (typeof author === 'string') {
      const { name, email, url } = AUTHOR_LINE.exec(author.trim())?.groups ?? {}
      if (name === undefined) return undefined
      return { name, ...(email !== undefined && { email }), ...(url !== undefined && { url }) }
    }
    const parsed = v.safeParse(AuthorObjectSchema, author)
    if (!parsed.success) return undefined
    const { name, email, url } = parsed.output
    return { name, ...(email !== undefined && { email }), ...(url !== undefined && { url }) }
  }

  /**
   * Convert a package `name` into a normalized harness plugin identifier.
   *
   * Strips any `@scope/` prefix, slugifies to lowercase ASCII with `-` separators, and truncates to
   * 64 characters (for example, `@me/Branch Status` -> `branch-status`).
   */
  static pluginName(name: string): string {
    const bare = name.replace(/^@[^/]+\//u, '')
    return slugify(bare, { decamelize: false }).slice(0, NAME_LENGTH)
  }

  /** Read this directory's `package.json`, throwing a `'manifest'` {@link DiagnosticError} if missing or invalid JSON. */
  readJson(): unknown {
    const file = join(this.#dir, 'package.json')
    if (!existsSync(file)) {
      throw DiagnosticError.atFile({
        code: 'manifest',
        message: 'a mod is a package, and its folder has no package.json',
        file,
      })
    }
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      const message = `package.json isn't JSON: ${Error.isError(error) ? error.message : String(error)}`
      throw DiagnosticError.atFile({ code: 'manifest', message, file, cause: error })
    }
  }

  /** Read and validate `package.json`, throwing a `'manifest'` {@link DiagnosticError} on invalid metadata. */
  readInfo(): ModInfo {
    const file = join(this.#dir, 'package.json')
    const parsed = v.safeParse(ManifestSchema, this.readJson())
    if (!parsed.success) {
      throw DiagnosticError.atFile({
        code: 'manifest',
        message:
          "a mod's package.json gives its name, version and description, which every harness shows",
        file,
      })
    }
    const { name, version, description, author } = parsed.output
    const by = ModManifest.parseAuthor(author)
    return { name, version, description, ...(by !== undefined && { author: by }) }
  }

  /** Resolve `tsconfig.json` in this directory, throwing a `'project'` {@link DiagnosticError} if absent. */
  resolveTsconfig(): string {
    const file = resolve(this.#dir, 'tsconfig.json')
    if (existsSync(file)) return file
    throw DiagnosticError.atFile({
      code: 'project',
      message: "a mod's project is configured by tsconfig.json, beside its package.json",
      file,
    })
  }
}
