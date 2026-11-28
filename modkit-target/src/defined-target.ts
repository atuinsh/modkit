import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type * as v from 'valibot'

import type { Diagnostic } from '@atuin/modkit-compiler'

import type { Capabilities } from './host/capabilities.ts'
import type { HarnessTools } from './host/tools.ts'
import { PluginName } from './plugin-name.ts'
import { ModkitTarget, type BuildInput, type Built } from './target.ts'

const JSON_INDENT_SPACES = 2

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`

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

/** Input passed to a target's `build` callback via {@link TargetBuilder.build}. */
export interface TargetBuildContext<Options> extends BuildInput<Options> {
  /** Nominal plugin name derived from `compiled.mod.name`. */
  readonly plugin: PluginName
  /** Declarative writers flushed to `out` when `build` succeeds. */
  readonly emit: ArtifactWriter
}

/** Outcome returned by a {@link TargetBuilder.build} callback. */
export type TargetBuilt =
  | { readonly isOk?: true; readonly notes?: readonly string[] }
  | { readonly isOk: false; readonly diagnostics: readonly Diagnostic[] }
  | undefined

export interface TargetConfig<Options> {
  readonly name: string
  readonly capabilities: Capabilities
  readonly options: v.GenericSchema<unknown, Options>
  readonly tools: HarnessTools | undefined
  readonly build: (ctx: TargetBuildContext<Options>) => Promise<TargetBuilt> | TargetBuilt
}

type PendingArtifact =
  | { readonly kind: 'text'; readonly path: string; readonly content: string }
  | { readonly kind: 'copy'; readonly path: string; readonly from: string }
  | { readonly kind: 'task'; readonly task: (out: string) => Promise<void> }

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

export class DefinedTarget<Options> extends ModkitTarget<Options> {
  override readonly name: string
  override readonly capabilities: Capabilities
  override readonly options: v.GenericSchema<unknown, Options>
  readonly #config: TargetConfig<Options>

  constructor(config: TargetConfig<Options>) {
    super()
    this.name = config.name
    this.capabilities = config.capabilities
    this.options = config.options
    this.#config = config
  }

  override async build(input: BuildInput<Options>): Promise<Built> {
    const plugin = PluginName.fromPackage(input.compiled.mod.name)
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
    const result = await this.#config.build({ ...input, plugin, emit })
    if (result?.isOk === false) {
      return { isOk: false, diagnostics: result.diagnostics }
    }
    await flush({ out: input.out, artifacts })
    const missing =
      this.#config.tools === undefined ? [] : this.#config.tools.missingNotes(input.compiled.tools)
    return { isOk: true, plugin: plugin.toString(), notes: [...(result?.notes ?? []), ...missing] }
  }
}
