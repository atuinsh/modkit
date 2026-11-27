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

import { defineCommand, runMain } from 'citty'

import { Build } from './build.ts'

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
    const builds = await Build.of(args).once()
    if (builds.length === 0 || builds.some((one) => !one.isOk)) process.exitCode = 1
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
