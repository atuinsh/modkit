/**
 * The `modkit` field of a mod's `package.json`: the targets it builds for, and per target the gaps
 * it accepts and that target's options.
 *
 * ```json
 * "modkit": {
 *   "targets": ["claude-code", "codex"],
 *   "codex": { "gaps": ["panes"] }
 * }
 * ```
 *
 * @module
 */

import { join } from 'node:path'

import * as v from 'valibot'

import {
  MODPARTS,
  manifestAt,
  type Diagnostic,
  type DiagnosticCode,
  type ModpartName,
} from '@atuin/modkit-compiler'

/** One target a mod lists: its name, the gaps the mod accepts there, and the rest of its section. */
export interface Listed {
  name: string
  gaps: readonly ModpartName[]
  /** The target's section of the `modkit` field less its `gaps`, for the target's options. */
  options: Readonly<Record<string, unknown>>
}

export type Read<T> = { isOk: true; value: T } | { isOk: false; diagnostics: Diagnostic[] }

const TargetNameSchema = v.pipe(
  v.string(),
  v.regex(/^[a-z][a-z0-9-]*$/u, 'a target name is lowercase letters, digits and -'),
  v.check((name) => name !== 'targets', '`targets` names the list, not a target'),
)

const FieldSchema = v.looseObject({
  targets: v.pipe(
    v.array(TargetNameSchema),
    v.minLength(1, 'a mod builds for at least one target'),
    v.check((names) => new Set(names).size === names.length, 'a target is listed once'),
  ),
})

const SectionSchema = v.looseObject({
  gaps: v.optional(
    v.pipe(
      v.array(v.picklist(MODPARTS)),
      v.check((gaps) => new Set(gaps).size === gaps.length, 'a gap is listed once'),
    ),
    [],
  ),
})

const MISSING = 'a mod lists the agents it builds for: add "modkit": { "targets": ["claude-code"] }'

/** A diagnostic about `package.json`, whose JSON has no positions to anchor it to. */
export const manifestError = ({
  code,
  message,
  dir,
}: {
  code: DiagnosticCode
  message: string
  dir: string
}): Diagnostic => ({ code, message, file: join(dir, 'package.json'), line: 1, column: 1 })

/** The `issues` of a check of the `modkit` field at `at`, as one line: `modkit.targets: ...`. */
export const issuesAt = ({
  at,
  issues,
}: {
  at: string
  issues: readonly v.BaseIssue<unknown>[]
}): string =>
  issues
    .map((issue) => {
      const path = v.getDotPath(issue)
      return `${path === null ? at : `${at}.${path}`}: ${issue.message}`
    })
    .join('; ')

function listedFrom({
  name,
  section,
  dir,
}: {
  name: string
  section: unknown
  dir: string
}): Read<Listed> {
  const parsed = v.safeParse(SectionSchema, section ?? {})
  if (!parsed.success) {
    const message = issuesAt({ at: `modkit.${name}`, issues: parsed.issues })
    return { isOk: false, diagnostics: [manifestError({ code: 'targets', message, dir })] }
  }
  const { gaps, ...options } = parsed.output
  return { isOk: true, value: { name, gaps, options } }
}

const ManifestSchema = v.object({ modkit: v.optional(v.unknown()) })

const straysIn = ({
  targets,
  sections,
  dir,
}: {
  targets: readonly string[]
  sections: Readonly<Record<string, unknown>>
  dir: string
}): Diagnostic[] =>
  Object.keys(sections)
    .filter((key) => !targets.includes(key))
    .map((key) => {
      const message = `modkit.${key} configures ${key}, which modkit.targets does not list`
      return manifestError({ code: 'targets', message, dir })
    })

// The `modkit` field of the mod's package.json, which a mod without one is told to add.
function fieldIn(dir: string): Read<unknown> {
  const manifest = manifestAt(join(dir, 'package.json'))
  if (!manifest.isOk) return { isOk: false, diagnostics: [manifest.diagnostic] }
  const field = v.safeParse(ManifestSchema, manifest.manifest)
  const modkit = field.success ? field.output.modkit : undefined
  if (modkit !== undefined) return { isOk: true, value: modkit }
  return { isOk: false, diagnostics: [manifestError({ code: 'targets', message: MISSING, dir })] }
}

/** The targets the mod in `dir` lists in its `package.json`. */
export function listedIn(dir: string): Read<Listed[]> {
  const field = fieldIn(dir)
  if (!field.isOk) return field
  const parsed = v.safeParse(FieldSchema, field.value)
  if (!parsed.success) {
    const message = issuesAt({ at: 'modkit', issues: parsed.issues })
    return { isOk: false, diagnostics: [manifestError({ code: 'targets', message, dir })] }
  }
  const { targets, ...sections } = parsed.output
  const listed = targets.map((name) => listedFrom({ name, section: sections[name], dir }))
  const diagnostics = [
    ...straysIn({ targets, sections, dir }),
    ...listed.flatMap((one) => (one.isOk ? [] : one.diagnostics)),
  ]
  if (diagnostics.length > 0) return { isOk: false, diagnostics }
  return { isOk: true, value: listed.flatMap((one) => (one.isOk ? [one.value] : [])) }
}
