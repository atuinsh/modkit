#!/usr/bin/env node
/**
 * Entry point for the `modkit` CLI.
 *
 * ```text
 * modkit build [dir] [--out <dir>]  Compile the mod at `dir` and build it for each target it lists
 * modkit dev   [dir] [--out <dir>]  Build, then rebuild on file changes
 * ```
 *
 * `dir` defaults to the current working directory and `--out` defaults to `<dir>/dist`. A mod lists
 * its targets in its package.json, `"modkit": { "targets": ["claude-code"] }`, and installs each
 * one's package, `@atuin/modkit-claude-code`. Each target writes into `<out>/<target>`.
 *
 * @module
 */

import { join, relative, resolve } from 'node:path'

import { watch } from 'chokidar'
import { defineCommand, runMain } from 'citty'
import { uniqBy } from 'es-toolkit/array'
import { debounce } from 'es-toolkit/function'

import { formatDiagnostic, type Diagnostic } from '@atuin/modkit-compiler'
import {
  errorMessage,
  gapText,
  ModPackage,
  type CompiledMod,
  type Gap,
  type ListedTarget,
} from '@atuin/modkit-target'

const QUIET_MS = 150

function shown(path: string): string {
  const near = relative(process.cwd(), path)
  return near === '' ? '.' : near
}

function failed(diagnostics: readonly Diagnostic[]): false {
  const lines = diagnostics.map((one) => formatDiagnostic({ ...one, file: shown(one.file) }))
  console.error(lines.join('\n'))
  return false
}

const gapNote = (gap: Gap): string => `  ${gapText(gap)} (accepted in package.json)`

/** A compiled mod and the gaps its package.json accepts on one target, ready to build for it. */
interface Checked {
  compiled: CompiledMod
  gaps: readonly Gap[]
}

/** A build of the mod in `dir` into `out`, for each target the mod's package.json lists. */
class Build {
  readonly #package: ModPackage
  readonly #out: string

  constructor({ modPackage, out }: { modPackage: ModPackage; out: string }) {
    this.#package = modPackage
    this.#out = out
  }

  /** The build the `build` and `dev` commands' arguments ask for. */
  static of({ dir: given, out }: { dir: string | undefined; out: string | undefined }): Build {
    const dir = resolve(given ?? '.')
    return new Build({ modPackage: new ModPackage(dir), out: resolve(out ?? resolve(dir, 'dist')) })
  }

  /** Compile once, then build for each target in turn, reporting each; true when every one built. */
  async once(): Promise<boolean> {
    const targets = await this.#package.targets().catch((error: unknown) => errorMessage(error))
    if (typeof targets === 'string') {
      console.error(targets)
      return false
    }
    const compiled = this.#package.compile()
    if (!targets.isOk || !compiled.isOk) {
      // Both read package.json, so an unreadable one would be reported twice.
      const all = [
        ...(compiled.isOk ? [] : compiled.diagnostics),
        ...(targets.isOk ? [] : targets.diagnostics),
      ]
      return failed(uniqBy(all, (one) => formatDiagnostic(one)))
    }
    const checks = targets.value.map((target) => ({ target, checked: target.check(compiled) }))
    const diagnostics = checks.flatMap(({ checked }) => checked.diagnostics)
    if (diagnostics.length > 0) return failed(diagnostics)
    const builds: boolean[] = []
    for (const { target, checked } of checks) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, so their reports don't interleave
      builds.push(await this.#for(target, { compiled, gaps: checked.gaps }))
    }
    return builds.every(Boolean)
  }

  /** Build, then build again after each quiet spell of changes under the mod's directory. */
  async watch(): Promise<void> {
    await this.once()
    console.log(`watching ${shown(this.#package.dir)}`)
    let last: Promise<unknown> = Promise.resolve()
    const rebuild = debounce(() => {
      last = last.then(async () => this.once())
    }, QUIET_MS)
    const watcher = watch(this.#package.dir, {
      ignoreInitial: true,
      // The build writes inside `dir` by default; its own output must not start the next build.
      ignored: [{ path: this.#out, recursive: true }, /(?:^|\/)node_modules(?:\/|$)/u],
    })
    watcher.on('all', rebuild)
    watcher.on('error', (error: unknown) => {
      console.error(errorMessage(error))
    })
  }

  async #for(target: ListedTarget, { compiled, gaps }: Checked): Promise<boolean> {
    const out = join(this.#out, target.name)
    const built = await target.build(compiled, out).catch((error: unknown) => errorMessage(error))
    if (typeof built === 'string') {
      console.error(built)
      return false
    }
    if (!built.isOk) return failed(built.diagnostics)
    const accepted = gaps.map((gap) => gapNote(gap))
    const notes = built.notes.map((note) => `  ${note}`)
    console.log(
      [`built ${built.plugin} for ${target.name} into ${shown(out)}`, ...accepted, ...notes].join(
        '\n',
      ),
    )
    return true
  }
}

const buildArgs = {
  dir: {
    type: 'positional',
    description: 'Mod package directory (defaults to current directory)',
    required: false,
  },
  out: {
    type: 'string',
    description: 'Base output directory (defaults to <dir>/dist)',
    valueHint: 'dir',
  },
} as const

const buildCommand = defineCommand({
  meta: { name: 'build', description: 'Compile a mod and build it for each target it lists' },
  args: buildArgs,
  async run({ args }) {
    if (!(await Build.of(args).once())) process.exitCode = 1
  },
})

const devCommand = defineCommand({
  meta: { name: 'dev', description: 'Build a mod and rebuild on file changes' },
  args: buildArgs,
  async run({ args }) {
    await Build.of(args).watch()
  },
})

const main = defineCommand({
  meta: {
    name: 'modkit',
    description: 'Build modkit mods for coding-agent harnesses',
  },
  subCommands: {
    build: buildCommand,
    dev: devCommand,
  },
})

await runMain(main)
