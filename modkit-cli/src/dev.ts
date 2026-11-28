/**
 * The `dev` command, which runs the workspace in a tmux window of its own: a new session's when
 * it starts outside tmux, a new window of the current session's inside it.
 *
 * It runs itself again in that window, in the environment it was started in, with `MODKIT_DEV`
 * set, `session` or `window` for which of the two it made, and the run there opens the
 * {@link Workspace}.
 *
 * @module
 */

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'

import type { Env } from '@atuin/modkit-target'

import { Build } from './build.ts'
import { envFlags, hasSessionNamed, Pane } from './tmux.ts'
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

/** How much of a mod's path's hash its session's name carries. */
const SESSION_HASH_CHARS = 6

// The session `modkit dev` makes for the mod at `path`, `modkit-branch-status-3fa2b1`: the
// directory's name, for reading, and a hash of its path, so that mods of one name get one each. A
// session's name can't hold `.` or `:`, which tmux reads as a window and a pane.
function sessionNameOf(path: string): string {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, SESSION_HASH_CHARS)
  return `modkit-${basename(path).replaceAll(/[.:]/gu, '-')}-${hash}`
}

async function exitOf(argv: readonly string[]): Promise<number> {
  const exited: unknown[] = await once(spawn('tmux', argv, { stdio: 'inherit' }), 'exit')
  const [code] = exited
  return typeof code === 'number' ? code : 1
}

// Why the harnesses can't run in tmux from here, if they can't.
async function tmuxUnusable(): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return `modkit dev runs the harnesses in tmux, which needs a terminal; ${WITHOUT_HARNESSES}`
  }
  if (!(await hasTmux())) {
    return `modkit dev runs the harnesses in tmux, which is not on PATH; install it, or ${WITHOUT_HARNESSES}`
  }
  return undefined
}

// Makes the session for the mod at `dir`, then attaches to it, returning the exit code once it
// ends or is detached from.
async function attached({
  dir,
  name,
  at,
}: {
  dir: string
  name: string
  at: readonly string[]
}): Promise<number> {
  // Attaching to the one running would leave this run's arguments and environment unused. Two
  // started at once both get past this, and tmux refuses the second's session for its name.
  if (await hasSessionNamed(name)) {
    console.error(
      `modkit dev already runs ${dir} in tmux session ${name}; tmux attach -t ${name} gets back to it, and q there quits it`,
    )
    return 1
  }
  // Detached, so that the client with the environment in its argv exits at once, and at this
  // terminal's size, which the panes are laid out to.
  const size = ['-x', String(process.stdout.columns), '-y', String(process.stdout.rows)]
  const command = ['env', 'MODKIT_DEV=session', ...selfArgv()]
  await execFileAsync('tmux', ['new-session', '-d', '-s', name, ...size, ...at, '--', ...command])
  return exitOf(['attach-session', '-t', `=${name}`])
}

// Opens the window `modkit dev` runs itself in, returning the exit code. The window gets `env`
// with `-e`, which outside tmux sets it in the new session's environment; `MODKIT_DEV` goes with
// `env(1)` instead, so the session's other panes, the harnesses', don't inherit it.
async function opened({ args, env }: { args: DevArgs; env: Env }): Promise<number> {
  const unusable = await tmuxUnusable()
  if (unusable !== undefined) {
    console.error(unusable)
    return 1
  }
  const dir = resolve(args.dir ?? '.')
  const name = sessionNameOf(dir)
  // The run in the window resolves `dir` and `--out` from here, as this one would have.
  const at = ['-n', name, '-c', process.cwd(), ...envFlags(env)]
  if (env['TMUX'] === undefined) return attached({ dir, name, at })
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
  // The harnesses get the environment `modkit dev` was started in, which is this one but for it.
  const { MODKIT_DEV: mode, ...started } = env
  const pane = env['TMUX_PANE']
  if (mode === undefined || pane === undefined) return opened({ args, env })
  const workspace = new Workspace({
    build: Build.of(args),
    log: new Pane(pane),
    cwd: resolve(args.cwd ?? '.'),
    picked: pickedOf(args.only),
    env: started,
    hasSession: mode === 'session',
  })
  await workspace.run()
  return 0
}
