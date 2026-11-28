/**
 * A mod's package, whose package.json's `modkit` field lists the targets it builds for, and per
 * target the gaps it accepts and that target's options.
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

import { findPackageJSON } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolve as resolveImport } from 'import-meta-resolve'
import * as v from 'valibot'

import {
  compile,
  MODPARTS,
  manifestAt,
  type Compiled,
  type Diagnostic,
  type DiagnosticCode,
  type ModpartName,
} from '@atuin/modkit-compiler'

import { errorMessage } from './host/values.ts'
import { ListedTarget } from './listed-target.ts'
import { TargetRef } from './target-ref.ts'
import { ModkitTarget } from './target.ts'

export type Read<T> = { isOk: true; value: T } | { isOk: false; diagnostics: Diagnostic[] }

/** One target a mod lists: its ref, the gaps the mod accepts there, and the rest of its section. */
interface Listing {
  ref: TargetRef
  gaps: readonly ModpartName[]
  /** The target's section of the `modkit` field less its `gaps`, for the target's options. */
  options: Readonly<Record<string, unknown>>
}

const TargetRefSchema = v.pipe(
  v.string(),
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    const parsed = TargetRef.parse(dataset.value).outcome
    if (parsed.isOk) return parsed.value
    addIssue({ message: parsed.error })
    return NEVER
  }),
)

const FieldSchema = v.looseObject({
  targets: v.pipe(
    v.array(TargetRefSchema),
    v.minLength(1, 'a mod builds for at least one target'),
    v.check(
      (refs) => new Set(refs.map((ref) => ref.name)).size === refs.length,
      'a target is listed once',
    ),
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

const ManifestSchema = v.object({ modkit: v.optional(v.unknown()) })

const MISSING = 'a mod lists the agents it builds for: add "modkit": { "targets": ["claude-code"] }'

// The module is another package's, so what it exports is checked here rather than taken from its
// types: an instance of the class a target extends.
const ModuleSchema = v.object({
  target: v.custom<ModkitTarget>(
    (value) => value instanceof ModkitTarget,
    'its target is no instance of the ModkitTarget @atuin/modkit-target exports',
  ),
})

/** The `issues` of a check of the `modkit` field at `at`, as one line: `modkit.targets: ...`. */
const issuesAt = ({
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

/** The package of a mod in `dir`: the mod the compiler reads, and the targets it builds for. */
export class ModPackage {
  readonly #dir: string

  constructor(dir: string) {
    this.#dir = dir
  }

  /** The package's directory. */
  get dir(): string {
    return this.#dir
  }

  /** Compile the mod the package holds, blocking imports of its listed target packages too. */
  compile(): Compiled {
    const listed = this.#listed()
    const targetPackages = listed.isOk ? listed.value.map((one) => one.ref.packageName) : []
    return compile({ dir: this.#dir, targetPackages })
  }

  /** Load each target the package lists from its `node_modules`, or say why one can't be. */
  async targets(): Promise<Read<ListedTarget[]>> {
    const listed = this.#listed()
    if (!listed.isOk) return listed
    const all = await Promise.all(listed.value.map(async (one) => this.#loaded(one)))
    const diagnostics: Diagnostic[] = all.flatMap((one) => (one.isOk ? [] : one.diagnostics))
    if (diagnostics.length > 0) return { isOk: false, diagnostics }
    return { isOk: true, value: all.flatMap((one) => (one.isOk ? [one.value] : [])) }
  }

  /** A diagnostic about the package's package.json, whose JSON has no positions to anchor it to. */
  error(code: DiagnosticCode, message: string): Diagnostic {
    return { code, message, file: join(this.#dir, 'package.json'), line: 1, column: 1 }
  }

  #failed(code: DiagnosticCode, message: string): Read<never> {
    return { isOk: false, diagnostics: [this.error(code, message)] }
  }

  // The `modkit` field of package.json, which a mod without one is told to add.
  #field(): Read<unknown> {
    const manifest = manifestAt(join(this.#dir, 'package.json'))
    if (!manifest.isOk) return { isOk: false, diagnostics: [manifest.diagnostic] }
    const field = v.safeParse(ManifestSchema, manifest.manifest)
    const modkit = field.success ? field.output.modkit : undefined
    if (modkit !== undefined) return { isOk: true, value: modkit }
    return this.#failed('targets', MISSING)
  }

  #listed(): Read<Listing[]> {
    const field = this.#field()
    if (!field.isOk) return field
    const parsed = v.safeParse(FieldSchema, field.value)
    if (!parsed.success) {
      return this.#failed('targets', issuesAt({ at: 'modkit', issues: parsed.issues }))
    }
    const { targets, ...sections } = parsed.output
    const names = targets.map((ref) => ref.name)
    const listed = targets.map((ref) => this.#listing(ref, sections[ref.name]))
    const diagnostics = [
      ...this.#strays(names, sections),
      ...listed.flatMap((one) => (one.isOk ? [] : one.diagnostics)),
    ]
    if (diagnostics.length > 0) return { isOk: false, diagnostics }
    return { isOk: true, value: listed.flatMap((one) => (one.isOk ? [one.value] : [])) }
  }

  #listing(ref: TargetRef, section: unknown): Read<Listing> {
    const parsed = v.safeParse(SectionSchema, section ?? {})
    if (!parsed.success) {
      return this.#failed('targets', issuesAt({ at: `modkit.${ref.name}`, issues: parsed.issues }))
    }
    const { gaps, ...options } = parsed.output
    return { isOk: true, value: { ref, gaps, options } }
  }

  // Sections of the `modkit` field for targets it does not list.
  #strays(targets: readonly string[], sections: Readonly<Record<string, unknown>>): Diagnostic[] {
    return Object.keys(sections)
      .filter((key) => !targets.includes(key))
      .map((key) =>
        this.error(
          'targets',
          `modkit.${key} configures ${key}, which modkit.targets does not list`,
        ),
      )
  }

  // Resolved from the package's directory, where the mod installs the targets it builds for.
  // What the mod's own imports resolve from.
  get #importer(): string {
    return pathToFileURL(join(this.#dir, 'package.json')).href
  }

  // Whether the mod has package `pkg` installed. A failure other than its absence is thrown, not
  // taken for it.
  #isInstalled(pkg: string): boolean {
    try {
      return findPackageJSON(pkg, this.#importer) !== undefined
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') {
        return false
      }
      throw error
    }
  }

  // The URL of target `ref`'s codegen, resolved from the mod as an import, so a target's package
  // can export it under an `import` condition and the CLI loads the build the mod itself would.
  #entryOf(ref: TargetRef): Read<string> {
    const pkg = ref.packageName
    if (!this.#isInstalled(pkg)) {
      const message = `modkit.targets lists ${ref.name}; add ${pkg} to the mod's devDependencies`
      return this.#failed('target-missing', message)
    }
    try {
      return { isOk: true, value: resolveImport(`${pkg}/codegen`, this.#importer) }
    } catch (error) {
      const message = `${pkg} is installed, but its ./codegen does not resolve as an import: ${errorMessage(error)}`
      return this.#failed('target-missing', message)
    }
  }

  async #targetNamed(ref: TargetRef): Promise<Read<ModkitTarget>> {
    const entry = this.#entryOf(ref)
    if (!entry.isOk) return entry
    const module: unknown = await import(entry.value)
    const exported = v.safeParse(ModuleSchema, module)
    if (!exported.success) {
      const [issue] = exported.issues
      const message = `${ref.packageName}/codegen exports no target ${ref.name}: ${issue.message}`
      return this.#failed('target-missing', message)
    }
    const { target } = exported.output
    if (target.name === ref.name) return { isOk: true, value: target }
    const message = `${ref.packageName}/codegen exports target ${target.name}, not ${ref.name}`
    return this.#failed('target-missing', message)
  }

  async #loaded(listing: Listing): Promise<Read<ListedTarget>> {
    const target = await this.#targetNamed(listing.ref)
    if (!target.isOk) return target
    const options = v.safeParse(target.value.options, listing.options)
    if (!options.success) {
      const message = issuesAt({ at: `modkit.${listing.ref.name}`, issues: options.issues })
      return this.#failed('target-options', message)
    }
    const { gaps } = listing
    return {
      isOk: true,
      value: new ListedTarget({
        listedBy: this,
        target: target.value,
        gaps,
        options: options.output,
      }),
    }
  }
}
