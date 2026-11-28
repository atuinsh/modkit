/**
 * The tmux that `modkit dev` lays its window out in, driven through tmux's CLI.
 *
 * Commands go to tmux as argv, never through a shell, so nothing is quoted.
 *
 * @module
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { DevCommand, Env } from '@atuin/modkit-target'

// oxlint-disable-next-line typescript/strict-void-return -- promisify has its own overload for execFile
const execFileAsync = promisify(execFile)

/** Run tmux with `args`, returning what it printed less its trailing newline. */
async function tmux(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('tmux', args, { encoding: 'utf8' })
  return stdout.trimEnd()
}

// What tmux sets in each pane itself, which `-e` would override with the value from outside it:
// the server and pane the pane is in, the terminal tmux emulates rather than the one it runs in,
// and the directory the pane starts in.
const PANE_OWN: ReadonlySet<string> = new Set([
  'TMUX',
  'TMUX_PANE',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'PWD',
])

/**
 * The `-e` flags that set `env` in a pane tmux starts, but for the variables tmux sets itself.
 *
 * The values land in tmux's argv, which other users may read for as long as its client runs, so
 * they go only to a client that sends its one command and exits.
 */
export const envFlags = (env: Env): string[] =>
  Object.entries(env).flatMap(([name, value]) =>
    value === undefined || PANE_OWN.has(name) ? [] : ['-e', `${name}=${value}`],
  )

/** Whether the tmux server has a session named exactly `name`. */
export async function hasSessionNamed(name: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', `=${name}`])
    return true
  } catch (error) {
    // An exit of 1 is tmux's no, which it also gives when no server runs at all.
    if (error instanceof Error && 'code' in error && error.code === 1) return false
    throw error
  }
}

/** Where a pane split off another goes. */
type Side = 'above' | 'right'

const SPLITS: Readonly<Record<Side, readonly string[]>> = { above: ['-v', '-b'], right: ['-h'] }

/** The pane option a pane's border shows. */
const LABEL = '@modkit-label'

/** A tmux pane, by its id `%3`, and the window and session it is in. */
export class Pane {
  readonly #id: string

  constructor(id: string) {
    this.#id = id
  }

  /** Split a pane off this one on `side`, taking `percent` of this one's space, running `argv`. */
  async split({
    side,
    percent,
    argv,
  }: {
    side: Side
    percent: number
    argv: readonly string[]
  }): Promise<Pane> {
    const flags = [...SPLITS[side], '-l', `${percent}%`, '-t', this.#id, '-P', '-F', '#{pane_id}']
    return new Pane(await tmux(['split-window', ...flags, '--', ...argv]))
  }

  /**
   * Kill whatever the pane runs and run `command` in `cwd` in its place, with `env` set over the
   * tmux server's environment, but for the variables tmux sets in each pane itself.
   */
  async respawn({
    command,
    cwd,
    env,
  }: {
    command: DevCommand
    cwd: string
    env: Env
  }): Promise<void> {
    const flags = ['-k', '-t', this.#id, '-c', cwd, ...envFlags(env)]
    await tmux(['respawn-pane', ...flags, '--', command.program, ...command.args])
  }

  /** Show `text` in the pane's border. */
  async label(text: string): Promise<void> {
    await tmux(['set-option', '-p', '-t', this.#id, LABEL, text])
  }

  /** Whether what the pane ran has exited, which leaves it on screen while `remain-on-exit` is on. */
  async isDead(): Promise<boolean> {
    return (await tmux(['display-message', '-p', '-t', this.#id, '#{pane_dead}'])) === '1'
  }

  /** Type `text` into the pane, then Enter. */
  async sendLine(text: string): Promise<void> {
    await tmux(['send-keys', '-t', this.#id, '-l', '--', text])
    await tmux(['send-keys', '-t', this.#id, 'Enter'])
  }

  /**
   * Set up the pane's window to show each pane's label in its top border and keep a pane whose
   * program exited, and turn the mouse on in its session when `hasSession`.
   */
  async decorate({ hasSession }: { hasSession: boolean }): Promise<void> {
    const options: readonly (readonly [string, string])[] = [
      ['pane-border-status', 'top'],
      ['pane-border-format', ` #{${LABEL}} `],
      ['remain-on-exit', 'on'],
    ]
    await Promise.all(
      options.map(async ([name, value]) => tmux(['set-option', '-w', '-t', this.#id, name, value])),
    )
    if (hasSession) await tmux(['set-option', '-t', this.#id, 'mouse', 'on'])
  }

  /** Kill the pane's session when `hasSession`, and only its window otherwise. */
  async killAll({ hasSession }: { hasSession: boolean }): Promise<void> {
    await tmux([hasSession ? 'kill-session' : 'kill-window', '-t', this.#id])
  }
}

/** Whether the tmux server has `extended-keys` on, which tells Shift+Enter from Enter. */
export async function hasExtendedKeys(): Promise<boolean> {
  return (await tmux(['show-options', '-sv', 'extended-keys'])) !== 'off'
}
