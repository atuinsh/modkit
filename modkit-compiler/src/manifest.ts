/**
 * Reading and validating a mod package's `package.json` metadata.
 *
 * @module
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import * as v from 'valibot'

import type { Diagnostic, DiagnosticCode } from './diagnostics.ts'
import type { Author, ModInfo } from './ir.ts'

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

const fileError = ({
  code,
  message,
  path,
}: {
  code: DiagnosticCode
  message: string
  path: string
}): Diagnostic => ({ code, message, file: path, line: 1, column: 1 })

function manifestAt(
  path: string,
): { isOk: true; manifest: unknown } | { isOk: false; diagnostic: Diagnostic } {
  if (!existsSync(path)) {
    const message = 'a mod is a package, and its folder has no package.json'
    return { isOk: false, diagnostic: fileError({ code: 'manifest', message, path }) }
  }
  try {
    return { isOk: true, manifest: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (error) {
    const message = `package.json isn't JSON: ${error instanceof Error ? error.message : String(error)}`
    return { isOk: false, diagnostic: fileError({ code: 'manifest', message, path }) }
  }
}

const AUTHOR_LINE = /^(?<name>[^<(]+?)\s*(?:<(?<email>[^>]+)>)?\s*(?:\((?<url>[^)]+)\))?$/u

/**
 * Parse an npm `package.json` `author` field into an {@link Author}.
 *
 * Accepts either a one-line string (`Name <email> (url)`, with email and url optional) or an
 * object with a non-empty `name` string. Returns `undefined` if `author` is missing or malformed.
 */
export function authorOf(author: unknown): Author | undefined {
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

/** Read and validate `package.json` in `dir`, returning {@link ModInfo} or a `'manifest'` diagnostic. */
export function modInfo(dir: string): ModInfo | Diagnostic {
  const path = join(dir, 'package.json')
  const read = manifestAt(path)
  if (!read.isOk) return read.diagnostic
  const parsed = v.safeParse(ManifestSchema, read.manifest)
  if (!parsed.success) {
    const message =
      "a mod's package.json gives its name, version and description, which every harness shows"
    return fileError({ code: 'manifest', message, path })
  }
  const { name, version, description, author } = parsed.output
  const by = authorOf(author)
  return { name, version, description, ...(by !== undefined && { author: by }) }
}

/** Resolve `tsconfig.json` in `dir`, or return a `'project'` diagnostic if it does not exist. */
export function tsconfigAt(dir: string): string | Diagnostic {
  const path = resolve(dir, 'tsconfig.json')
  if (existsSync(path)) return path
  const message = "a mod's project is configured by tsconfig.json, beside its package.json"
  return fileError({ code: 'project', message, path })
}
