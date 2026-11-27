import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import * as v from 'valibot'

import { pluginNameOf, type Diagnostic } from '@atuin/modkit-compiler'

import type { Capabilities } from './capabilities.ts'
import { ModkitTarget, type BuildInput, type Built } from './target.ts'

const JSON_INDENT_SPACES = 2

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

const NO_OPTIONS: v.GenericSchema<unknown, undefined> = v.pipe(
  v.strictObject({}),
  v.transform(() => undefined),
)

/** Declarative artifact writers flushed to `out` when a target's build succeeds. */
export interface ArtifactWriter {
  /** Emit a formatted JSON file relative to `out`. */
  json: (path: string, value: unknown) => void
  /** Emit a UTF-8 text file relative to `out`. */
  text: (path: string, content: string) => void
  /** Copy a file from `from` to `path` relative to `out`. */
  copy: (path: string, from: string) => void
  /** Queue an async writer (such as a bundler) targeting `out`. */
  write: (task: (out: string) => Promise<void>) => void
}

/** Input passed to a target defined via {@link defineTarget}. */
export interface TargetBuildContext<Options> extends BuildInput<Options> {
  /** The harness's plugin name derived from `compiled.mod.name`. */
  readonly plugin: string
  /** Declarative writers flushed to `out` when `build` succeeds. */
  readonly emit: ArtifactWriter
}

/** Outcome returned by a {@link defineTarget} `build` callback. */
export type TargetBuilt =
  | { readonly isOk?: true; readonly notes?: readonly string[] }
  | { readonly isOk: false; readonly diagnostics: readonly Diagnostic[] }
  | undefined

/** Built-in tool inventory used to warn when a mod hooks tools a harness does not provide. */
export interface KnownTools {
  readonly harness: string
  readonly has: ReadonlySet<string>
}

interface BaseTargetSpec<Options> {
  readonly name: string
  readonly capabilities: Capabilities
  readonly tools?: KnownTools
  readonly build: (ctx: TargetBuildContext<Options>) => Promise<TargetBuilt> | TargetBuilt
}

/** Specification for a target with no package.json options. */
export interface TargetSpec extends BaseTargetSpec<undefined> {
  readonly options?: undefined
}

/** Specification for a target with validated package.json options. */
export interface TargetSpecWithOptions<Options> extends BaseTargetSpec<Options> {
  readonly options: v.GenericSchema<unknown, Options>
}

type PendingArtifact =
  | { readonly kind: 'text'; readonly path: string; readonly content: string }
  | { readonly kind: 'copy'; readonly path: string; readonly from: string }
  | { readonly kind: 'task'; readonly task: (out: string) => Promise<void> }

function missingToolNotes({
  tools,
  harness,
  has,
}: {
  tools: { before: readonly string[]; after: readonly string[]; cards: readonly string[] }
  harness: string
  has: ReadonlySet<string>
}): string[] {
  const hooked = new Set([...tools.before, ...tools.after, ...tools.cards])
  return [...hooked]
    .filter((tool) => !has.has(tool) && !tool.startsWith('mcp__'))
    .toSorted()
    .map((tool) => `${harness} has no ${tool} tool, so what the mod does on it never runs there`)
}

async function flush({
  out,
  artifacts,
}: {
  out: string
  artifacts: readonly PendingArtifact[]
}): Promise<void> {
  await mkdir(out, { recursive: true })
  for (const artifact of artifacts) {
    if (artifact.kind === 'task') {
      // oxlint-disable-next-line no-await-in-loop -- preserve declaration order for bundlers and copies
      await artifact.task(out)
      continue
    }
    const dest = join(out, artifact.path)
    // oxlint-disable-next-line no-await-in-loop -- parent dir must exist before the file write
    await mkdir(dirname(dest), { recursive: true })
    // oxlint-disable-next-line no-await-in-loop -- sequential flush avoids directory races
    await (artifact.kind === 'copy'
      ? copyFile(artifact.from, dest)
      : writeFile(dest, artifact.content))
  }
}

class DefinedTarget<Options> extends ModkitTarget<Options> {
  override readonly name: string
  override readonly capabilities: Capabilities
  override readonly options: v.GenericSchema<unknown, Options>
  readonly #spec: BaseTargetSpec<Options>

  constructor(spec: BaseTargetSpec<Options>, options: v.GenericSchema<unknown, Options>) {
    super()
    this.name = spec.name
    this.capabilities = spec.capabilities
    this.options = options
    this.#spec = spec
  }

  override async build(input: BuildInput<Options>): Promise<Built> {
    const plugin = pluginNameOf(input.compiled.mod.name)
    const artifacts: PendingArtifact[] = []
    const emit: ArtifactWriter = {
      json: (path, value) => {
        artifacts.push({ kind: 'text', path, content: jsonText(value) })
      },
      text: (path, content) => {
        artifacts.push({ kind: 'text', path, content })
      },
      copy: (path, from) => {
        artifacts.push({ kind: 'copy', path, from })
      },
      write: (task) => {
        artifacts.push({ kind: 'task', task })
      },
    }
    const result = await this.#spec.build({ ...input, plugin, emit })
    if (result?.isOk === false) {
      return { isOk: false, diagnostics: result.diagnostics }
    }
    await flush({ out: input.out, artifacts })
    const missing =
      this.#spec.tools === undefined
        ? []
        : missingToolNotes({ tools: input.compiled.tools, ...this.#spec.tools })
    return { isOk: true, plugin, notes: [...(result?.notes ?? []), ...missing] }
  }
}

/** Define a harness {@link ModkitTarget} declaratively with managed artifact emission. */
export function defineTarget(spec: TargetSpec): ModkitTarget<undefined>
export function defineTarget<Options>(spec: TargetSpecWithOptions<Options>): ModkitTarget<Options>
export function defineTarget<Options>(
  spec: TargetSpec | TargetSpecWithOptions<Options>,
): ModkitTarget<undefined> | ModkitTarget<Options> {
  if (spec.options !== undefined) return new DefinedTarget(spec, spec.options)
  return new DefinedTarget(spec, NO_OPTIONS)
}
