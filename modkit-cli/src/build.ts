import { join, relative, resolve } from 'node:path'

import { watch } from 'chokidar'
import { uniqBy } from 'es-toolkit/array'
import { debounce } from 'es-toolkit/function'

import { formatDiagnostic, type Diagnostic } from '@atuin/modkit-compiler'
import {
  errorMessage,
  gapText,
  ModPackage,
  Result,
  type CompiledMod,
  type Gap,
  type ListedTarget,
} from '@atuin/modkit-target'

/** How long the mod's directory stays unchanged before a build starts. */
const QUIET = Temporal.Duration.from({ milliseconds: 150 })

function shown(path: string): string {
  const near = relative(process.cwd(), path)
  return near === '' ? '.' : near
}

const formatted = (diagnostics: readonly Diagnostic[]): string =>
  diagnostics.map((one) => formatDiagnostic({ ...one, file: shown(one.file) })).join('\n')

function failed(diagnostics: readonly Diagnostic[]): void {
  console.error(formatted(diagnostics))
}

const gapNote = (gap: Gap): string => `  ${gapText(gap)} (accepted in package.json)`

/** A compiled mod and the gaps its package.json accepts on one target, ready to build for it. */
interface Checked {
  compiled: CompiledMod
  gaps: readonly Gap[]
}

/** What one build of the mod came to for one of its targets. */
export type TargetBuild = {
  target: ListedTarget
  /** Where the target's build is, `<out>/<target name>`. */
  out: string
} & (
  | {
      isOk: true
      /** The harness's name for the package the build wrote, `atuin-mod`. */
      plugin: string
      /** Whether the mod has a status. */
      hasStatus: boolean
    }
  | { isOk: false }
)

/** Runs `build`, one of {@link Build.watch}'s builds, when it suits the caller. */
type Round = (build: () => Promise<TargetBuild[]>) => Promise<unknown>

/** A build of the mod in `dir` into `out`, for each target the mod's package.json lists. */
export class Build {
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

  /** The base directory each target's build goes under. */
  get out(): string {
    return this.#out
  }

  /** Where the build for the target `name` goes, `<out>/<name>`. */
  targetOut(name: string): string {
    return join(this.#out, name)
  }

  /** The mod's package directory. */
  get dir(): string {
    return this.#package.dir
  }

  /** The targets the mod's package.json lists, or why they can't be read. */
  async listed(): Promise<Result<readonly ListedTarget[], string>> {
    const targets = await this.#package.targets().catch((error: unknown) => errorMessage(error))
    if (typeof targets === 'string') return Result.err(targets)
    if (!targets.isOk) return Result.err(formatted(targets.diagnostics))
    return Result.ok(targets.value)
  }

  /**
   * Compile once, then build for each target in turn, reporting each.
   *
   * Empty when the targets could not be loaded; a target whose build never ran, because the mod
   * failed to compile or check, is not ok.
   */
  async once(): Promise<TargetBuild[]> {
    const targets = await this.#package.targets().catch((error: unknown) => errorMessage(error))
    if (typeof targets === 'string') {
      console.error(targets)
      return []
    }
    const compiled = this.#package.compile()
    if (targets.isOk && compiled.isOk) return this.#checked(targets.value, compiled)
    // Both read package.json, so an unreadable one would be reported twice.
    const all = [
      ...(compiled.isOk ? [] : compiled.diagnostics),
      ...(targets.isOk ? [] : targets.diagnostics),
    ]
    failed(uniqBy(all, (one) => formatDiagnostic(one)))
    return targets.isOk ? targets.value.map((target) => this.#unbuilt(target)) : []
  }

  /**
   * Build, then build again after each quiet spell of changes under the mod's directory.
   *
   * Each build is handed to `round` to run, which may hold it back until other work is done; the
   * next build waits for `round` to finish.
   */
  async watch(round: Round = async (build) => build()): Promise<void> {
    const once = async (): Promise<TargetBuild[]> => this.once()
    await round(once)
    console.log(`watching ${shown(this.#package.dir)}`)
    let last: Promise<unknown> = Promise.resolve()
    const rebuild = debounce(() => {
      last = last.then(async () => round(once))
    }, QUIET.total('millisecond'))
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

  // Build for each target, once the mod checks against every one.
  async #checked(targets: readonly ListedTarget[], compiled: CompiledMod): Promise<TargetBuild[]> {
    const checks = targets.map((target) => ({ target, checked: target.check(compiled) }))
    const diagnostics = checks.flatMap(({ checked }) => checked.diagnostics)
    if (diagnostics.length > 0) {
      failed(diagnostics)
      return checks.map(({ target }) => this.#unbuilt(target))
    }
    const builds: TargetBuild[] = []
    for (const { target, checked } of checks) {
      // oxlint-disable-next-line no-await-in-loop -- one at a time, so their reports don't interleave
      builds.push(await this.#for(target, { compiled, gaps: checked.gaps }))
    }
    return builds
  }

  #unbuilt(target: ListedTarget): TargetBuild {
    return { target, out: this.targetOut(target.name), isOk: false }
  }

  async #for(target: ListedTarget, { compiled, gaps }: Checked): Promise<TargetBuild> {
    const out = this.targetOut(target.name)
    const built = await target.build(compiled, out).catch((error: unknown) => errorMessage(error))
    if (typeof built === 'string') {
      console.error(built)
      return this.#unbuilt(target)
    }
    if (!built.isOk) {
      failed(built.diagnostics)
      return this.#unbuilt(target)
    }
    const accepted = gaps.map((gap) => gapNote(gap))
    const notes = built.notes.map((note) => `  ${note}`)
    console.log(
      [`built ${built.plugin} for ${target.name} into ${shown(out)}`, ...accepted, ...notes].join(
        '\n',
      ),
    )
    return { target, out, isOk: true, plugin: built.plugin, hasStatus: compiled.hooks.hasStatus }
  }
}
