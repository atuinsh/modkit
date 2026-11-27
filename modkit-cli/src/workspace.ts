/**
 * The tmux window `modkit dev` runs in: a pane per target, side by side, each running the target's
 * harness on the mod's build, above the pane `modkit dev` prints its builds in.
 *
 * On each build, a harness whose build changed is brought onto it: Claude Code reloads its own,
 * the rest are restarted on the session they were on. A harness whose build failed keeps running
 * the last one. The log pane takes keys: `r` restarts every harness, a pane's number restarts
 * that one, `p` types a prompt into each, and `q` quits, undoing what the harnesses registered.
 *
 * @module
 */

import { join } from 'node:path'
import { emitKeypressEvents, type Key } from 'node:readline'
import { createInterface } from 'node:readline/promises'

import { errorMessage, type Env } from '@atuin/modkit-target'

import type { Build, TargetBuild } from './build.ts'
import { HarnessPane } from './harness-pane.ts'
import { hasExtendedKeys, type Pane } from './tmux.ts'

/** Which of the mod's targets get a pane. */
export type Picked = { kind: 'all' } | { kind: 'only'; names: readonly string[] }

/** The share of the window's height the harnesses' row takes from the log pane below it. */
const HARNESS_ROW_PERCENT = 80
const PERCENT = 100

const waitingFor = (name: string): string[] => ['echo', `waiting for a build of ${name}`]

/** What a workspace is opened on. */
export interface WorkspaceInput {
  build: Build
  /** The pane `modkit dev` runs in, which prints its builds and reads keys. */
  log: Pane
  /** The directory the harnesses start in. */
  cwd: string
  picked: Picked
  env: Env
  /** Whether `modkit dev` made the tmux session, and so may set its options and kill it. */
  hasSession: boolean
}

/** A pane for each of `names`, all the same width, in a row above `log`. */
async function rowOf({
  log,
  names,
}: {
  log: Pane
  names: readonly string[]
}): Promise<{ pane: Pane; name: string }[]> {
  const [first, ...rest] = names
  if (first === undefined) return []
  const panes = [
    await log.split({ side: 'above', percent: HARNESS_ROW_PERCENT, argv: waitingFor(first) }),
  ]
  for (const [index, name] of rest.entries()) {
    // Each pane gives up the share the panes still to come take, so all end the same width.
    const after = rest.length - index
    const percent = Math.round((after / (after + 1)) * PERCENT)
    const left = panes.at(-1) ?? log
    // oxlint-disable-next-line no-await-in-loop -- each pane splits off the one before it
    panes.push(await left.split({ side: 'right', percent, argv: waitingFor(name) }))
  }
  return names.map((name, index) => ({ pane: panes[index] ?? log, name }))
}

const HELP = 'modkit · r restarts all · 1-9 restarts one · p prompts all · q quits'

/** The window `modkit dev` lays out and runs the harnesses in. */
export class Workspace {
  readonly #input: WorkspaceInput
  #panes: HarnessPane[] | undefined
  #queue: Promise<unknown> = Promise.resolve()
  #closing: Promise<never> | undefined

  constructor(input: WorkspaceInput) {
    this.#input = input
  }

  /** Lay the window out, then build the mod on every save and bring the harnesses onto it. */
  async run(): Promise<void> {
    const { log, hasSession } = this.#input
    await log.decorate({ hasSession })
    await log.label(HELP)
    if (!(await hasExtendedKeys())) {
      console.log(
        "tmux's extended-keys is off, so the harnesses read Shift+Enter as Enter; tmux.conf turns it on with `set -s extended-keys on` and `set -s extended-keys-format csi-u`",
      )
    }
    this.#listen()
    await this.#input.build.watch(async (builds) => this.#serial(async () => this.#landed(builds)))
  }

  /**
   * Undo what the harnesses registered, then kill the window, and with it this process.
   *
   * A harness that fails to undo it leaves the window open, with the log pane saying why.
   */
  async close(): Promise<never> {
    this.#closing ??= this.#closed()
    return this.#closing
  }

  async #closed(): Promise<never> {
    // The window may be going already, and the terminal these would print to with it.
    process.stdout.on('error', () => undefined)
    process.stderr.on('error', () => undefined)
    const panes = this.#panes ?? []
    const closed = await Promise.all(
      panes.map(async (pane) => {
        try {
          await pane.close()
          return true
        } catch (error) {
          console.error(`${pane.name}: ${errorMessage(error)}`)
          return false
        }
      }),
    )
    if (!closed.every(Boolean)) {
      console.error('modkit dev quit, but the above is still to undo by hand')
      process.exit(1)
    }
    await this.#input.log.killAll({ hasSession: this.#input.hasSession }).catch(() => undefined)
    process.exit(0)
  }

  // Runs `step` once every step before it has finished, so builds, restarts and prompts never
  // overlap on one pane.
  async #serial(step: () => Promise<unknown>): Promise<void> {
    const next = this.#queue.then(step)
    this.#queue = next.catch((error: unknown) => {
      console.error(errorMessage(error))
    })
    await this.#queue
  }

  async #landed(builds: readonly TargetBuild[]): Promise<void> {
    // No targets could be read, and the build said why.
    if (builds.length === 0) return
    this.#panes ??= await this.#laidOut(builds.map((one) => one.target.name))
    const scratch = join(this.#input.build.out, '.dev')
    await Promise.all(
      (this.#panes ?? []).map(async (pane) => {
        const build = builds.find((one) => one.target.name === pane.name)
        if (build === undefined) return
        await pane
          .land({ build, scratch: join(scratch, pane.name) })
          .catch(async (error: unknown) => {
            console.error(`${pane.name}: ${errorMessage(error)}`)
            await pane.label('could not start; the log says why')
          })
      }),
    )
  }

  // One pane per picked target in a row above the log pane; undefined when the targets picked
  // aren't all the mod's.
  async #laidOut(listed: readonly string[]): Promise<HarnessPane[] | undefined> {
    const { picked, log, cwd, env } = this.#input
    const names = picked.kind === 'all' ? listed : picked.names
    const unlisted = names.filter((name) => !listed.includes(name))
    if (unlisted.length > 0) {
      console.error(
        `--only names ${unlisted.join(', ')}, which modkit.targets does not list (it lists ${listed.join(', ')})`,
      )
      return undefined
    }
    const row = await rowOf({ log, names })
    const harnesses = row.map(
      ({ pane, name }, index) => new HarnessPane({ pane, name, number: index + 1, cwd, env }),
    )
    await Promise.all(harnesses.map(async (harness) => harness.label('waiting for a build')))
    return harnesses
  }

  #listen(): void {
    emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.on('keypress', this.#onKey)
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void this.close()
      })
    }
  }

  readonly #onKey = (text: string | undefined, key: Key | undefined): void => {
    if (text === 'q' || (key?.ctrl === true && key.name === 'c')) {
      void this.close()
      return
    }
    if (text === 'p') {
      void this.#prompt()
      return
    }
    const panes = this.#panes ?? []
    const restarted = text === 'r' ? panes : panes.filter((one) => String(one.number) === text)
    if (restarted.length === 0) return
    void this.#serial(async () => Promise.all(restarted.map(async (one) => one.restart())))
  }

  // Reads a line in the log pane and types it into every harness.
  async #prompt(): Promise<void> {
    process.stdin.off('keypress', this.#onKey)
    const lines = createInterface({ input: process.stdin, output: process.stdout })
    // Closing the interface leaves a question it asked waiting; aborting it ends it.
    const cancelled = new AbortController()
    lines.on('SIGINT', () => {
      cancelled.abort()
    })
    const question = lines.question('prompt every harness> ', { signal: cancelled.signal })
    const line = await question.catch(() => {
      console.log()
      return ''
    })
    lines.close()
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('keypress', this.#onKey)
    if (line.trim() === '') return
    const panes = this.#panes ?? []
    await this.#serial(async () => Promise.all(panes.map(async (one) => one.sendLine(line))))
  }
}
