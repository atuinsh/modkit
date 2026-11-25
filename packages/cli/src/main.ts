#!/usr/bin/env node
/**
 * Entry point for the `modkit` CLI.
 *
 * ```text
 * modkit build [dir] [--target claude] [--out <dir>]  Compile and bundle the mod at `dir`
 * modkit dev   [dir] [--target claude] [--out <dir>]  Build, then rebuild on file changes
 * ```
 *
 * `dir` defaults to the current working directory and `--out` defaults to `<dir>/dist`. Each
 * target emits its plugin into `<out>/<target>` (load Claude Code's with
 * `claude --plugin-dir <out>/claude`).
 *
 * @module
 */

import { join, relative, resolve } from 'node:path'

import { watch } from 'chokidar'
import { defineCommand, runMain } from 'citty'
import { debounce } from 'es-toolkit/function'

import { buildClaude } from '@atuin/modkit-claude/codegen'
import { formatDiagnostic, type Diagnostic } from '@atuin/modkit-compiler'

const QUIET_MS = 150

type Outcome =
  | {
      isOk: true
      plugin: string
      leftOut: readonly { modpart: string; count: number; why: string }[]
      notes: readonly string[]
    }
  | { isOk: false; diagnostics: readonly Diagnostic[] }

const TARGETS = {
  claude: async (paths: { dir: string; out: string }): Promise<Outcome> => {
    const built = await buildClaude(paths)
    return built.isOk ? { isOk: true, plugin: built.plugin, leftOut: [], notes: [] } : built
  },
} as const

type Target = keyof typeof TARGETS

const isTarget = (name: string): name is Target => Object.hasOwn(TARGETS, name)

const HARNESSES: Target[] = Object.keys(TARGETS).filter((name) => isTarget(name))

interface Paths {
  dir: string
  out: string
  targets: readonly Target[]
}

function shown(path: string): string {
  const near = relative(process.cwd(), path)
  return near === '' ? '.' : near
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function buildFor({
  dir,
  out,
  target,
}: {
  dir: string
  out: string
  target: Target
}): Promise<boolean> {
  const built = await TARGETS[target]({ dir, out }).catch((error: unknown) => messageOf(error))
  if (typeof built === 'string') {
    console.error(built)
    return false
  }
  if (!built.isOk) {
    const lines = built.diagnostics.map((one) =>
      formatDiagnostic({ ...one, file: shown(one.file) }),
    )
    console.error(lines.join('\n'))
    return false
  }
  const leftOut = built.leftOut.map(
    ({ modpart, count, why }) => `  leaves out ${count} ${modpart}: ${why}`,
  )
  const notes = built.notes.map((note) => `  ${note}`)
  console.log(
    [`built ${built.plugin} for ${target} into ${shown(out)}`, ...leftOut, ...notes].join('\n'),
  )
  return true
}

async function buildOnce({ dir, out, targets }: Paths): Promise<boolean> {
  const builds: boolean[] = []
  for (const target of targets) {
    // oxlint-disable-next-line no-await-in-loop -- one at a time, so their reports don't interleave
    builds.push(await buildFor({ dir, out: join(out, target), target }))
  }
  return builds.every(Boolean)
}

async function dev(paths: Paths): Promise<void> {
  const { dir, out } = paths
  await buildOnce(paths)
  const loads = paths.targets.includes('claude')
    ? `; load it with claude --plugin-dir ${join(out, 'claude')}`
    : ''
  console.log(`watching ${shown(dir)}${loads}`)
  let last = Promise.resolve()
  const rebuild = debounce(() => {
    last = last.then(async () => {
      await buildOnce(paths)
    })
  }, QUIET_MS)
  const watcher = watch(dir, {
    ignoreInitial: true,
    // The build writes inside `dir` by default; its own output must not start the next build.
    ignored: [{ path: out, recursive: true }, /(^|\/)node_modules(\/|$)/u],
  })
  watcher.on('all', rebuild)
  watcher.on('error', (error: unknown) => {
    console.error(messageOf(error))
  })
}

function pathsOf({
  dir: given,
  out,
  target,
}: {
  dir: string | undefined
  out: string | undefined
  target: Target | undefined
}): Paths {
  const dir = resolve(given ?? '.')
  return {
    dir,
    out: resolve(out ?? resolve(dir, 'dist')),
    targets: target === undefined ? HARNESSES : [target],
  }
}

const buildArgs = {
  dir: {
    type: 'positional',
    description: 'Mod package directory (defaults to current directory)',
    required: false,
  },
  target: {
    type: 'enum',
    description: 'Build for a single harness target',
    options: HARNESSES,
  },
  out: {
    type: 'string',
    description: 'Base output directory (defaults to <dir>/dist)',
    valueHint: 'dir',
  },
} as const

const buildCommand = defineCommand({
  meta: { name: 'build', description: 'Compile and bundle a mod' },
  args: buildArgs,
  async run({ args }) {
    if (!(await buildOnce(pathsOf(args)))) process.exitCode = 1
  },
})

const devCommand = defineCommand({
  meta: { name: 'dev', description: 'Build a mod and rebuild on file changes' },
  args: buildArgs,
  async run({ args }) {
    await dev(pathsOf(args))
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
