/**
 * The `dev` command, which runs the workspace in a tmux window of its own: a new session's when
 * it starts outside tmux, a new window of the current session's inside it.
 *
 * It runs itself again in that window with `MODKIT_DEV` set, `session` or `window` for which of
 * the two it made, and the run there opens the {@link Workspace}.
 *
 * @module
 */

import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { Env } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { Pane } from './tmux.ts'
import { Workspace, type Picked } from './workspace.ts'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

/** What the `dev` command is run with. */
export interface DevArgs {
  dir: string | undefined
  out: string | undefined
  cwd: string | undefined
  only: string | undefined
}

const WITHOUT_HARNESSES = 'run modkit build --watch to rebuild on save without them'

const pickedOf = (only: string | undefined): Picked => {
  if (only === undefined) return { kind: 'all' }
  const names = only.split(',').map((name) => name.trim())
  return { kind: 'only', names: names.filter((name) => name !== '') }
}

async function hasTmux(): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['-V'])
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

// This process's own command line, so that it runs again as it was run, under tsx or not.
const selfArgv = (): string[] => [process.execPath, ...process.execArgv, ...process.argv.slice(1)]

// A session's name can't hold `.` or `:`, which tmux reads as a window and a pane.
const sessionNameOf = (dir: string): string =>
  `modkit-${basename(resolve(dir)).replaceAll(/[.:]/gu, '-')}`

async function exitOf(argv: readonly string[]): Promise<number> {
  const exited: unknown[] = await once(spawn('tmux', argv, { stdio: 'inherit' }), 'exit')
  const [code] = exited
  return typeof code === 'number' ? code : 1
}

// Opens the window `modkit dev` runs itself in, returning the exit code. Only `env` carries
// `MODKIT_DEV`, which the harnesses' panes in the window then don't inherit.
async function opened({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `modkit dev runs the harnesses in tmux, which needs a terminal; ${WITHOUT_HARNESSES}`,
    )
    return 1
  }
  if (!(await hasTmux())) {
    console.error(
      `modkit dev runs the harnesses in tmux, which is not on PATH; install it, or ${WITHOUT_HARNESSES}`,
    )
    return 1
  }
  const name = sessionNameOf(args.dir ?? '.')
  // The run in the window resolves `dir` and `--out` from here, as this one would have.
  const at = ['-n', name, '-c', process.cwd()]
  if (env['TMUX'] === undefined) {
    const command = ['env', 'MODKIT_DEV=session', ...selfArgv()]
    return exitOf(['new-session', '-A', '-s', name, ...at, '--', ...command])
  }
  await execFileAsync('tmux', [
    'new-window',
    ...at,
    '--',
    'env',
    'MODKIT_DEV=window',
    ...selfArgv(),
  ])
  return 0
}

/** Run the `dev` command, returning its exit code once it returns at all. */
export async function dev({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  const mode = env['MODKIT_DEV']
  const pane = env['TMUX_PANE']
  if (mode === undefined || pane === undefined) return opened({ args, env })
  const workspace = new Workspace({
    build: Build.of(args),
    log: new Pane(pane),
    cwd: resolve(args.cwd ?? '.'),
    picked: pickedOf(args.only),
    env,
    hasSession: mode === 'session',
  })
  await workspace.run()
  return 0
}
