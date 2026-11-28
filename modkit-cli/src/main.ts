#!/usr/bin/env node
/**
 * Entry point for the `modkit` CLI.
 *
 * ```text
 * modkit build [dir] [--out <dir>] [--watch]  Compile the mod at `dir` and build it for each target
 *                                             it lists, and again on every save with --watch
 * modkit dev   [dir] [--out <dir>] [--cwd <dir>] [--only <a,b>]
 *                                             Build, and run each target's harness on the build
 *                                             in dekit, bringing each onto every save
 * ```
 *
 * `dir` defaults to the current working directory and `--out` defaults to `<dir>/dist`. A mod lists
 * its targets in its package.json, `"modkit": { "targets": ["claude-code"] }`, and installs each
 * one's package, `@atuin/modkit-claude-code`. Each target writes into `<out>/<target>`.
 *
 * `modkit dev` starts the harnesses in `--cwd`, the current directory by default, and runs only
 * the targets `--only` names, when given.
 *
 * @module
 */

import { defineCommand, runMain } from 'citty'

import type { Env } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { dev } from './dev.ts'

// The environment, read once here and handed down to what needs it.
// oxlint-disable-next-line node/no-process-env -- the one place the CLI reads it
const ENV: Env = process.env

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
  args: {
    ...buildArgs,
    watch: { type: 'boolean', description: 'Build again on every save' },
  },
  async run({ args }) {
    const build = Build.of(args)
    if (args.watch === true) {
      await build.watch()
      return
    }
    const builds = await build.once()
    if (builds.length === 0 || builds.some((one) => !one.isOk)) process.exitCode = 1
  },
})

const devCommand = defineCommand({
  meta: {
    name: 'dev',
    description: "Run each target's harness on the mod in dekit, rebuilt on every save",
  },
  args: {
    ...buildArgs,
    cwd: {
      type: 'string',
      description: 'Directory the harnesses start in (defaults to current directory)',
      valueHint: 'dir',
    },
    only: {
      type: 'string',
      description: 'The targets to run, comma-separated (defaults to every one the mod lists)',
      valueHint: 'targets',
    },
  },
  async run({ args }) {
    process.exitCode = await dev({ args, env: ENV })
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
