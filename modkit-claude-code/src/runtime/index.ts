/**
 * Claude Code runtime adapter that mounts a modkit mod onto Claude Code's hook engine.
 *
 * Lifecycle:
 * - The generated entry module makes one {@link ClaudeCodeRuntime} and registers its hooks.
 * - On `session.start`, preloads persisted state atoms into memory (so synchronous renders can
 *   read state without awaiting), mounts the mod, registers slash commands, starts a 1s resource
 *   tick, and bumps the view atom on every state-driven re-render so `ui.render` hooks redraw.
 * - Decision hooks fail open via `.catch((_, e, next) => next(e))` so mod faults never block the
 *   agent.
 *
 * Validator constraints (`claude plugin validate`):
 * - `on` is only called as `on("<event>", hook)` or passed to a top-level function of the bundle.
 * - `$` is only called as `$.noun.method(...)` or passed to a top-level function: never to a
 *   method, kept or returned. {@link engineOf} binds a hook's `$` into the {@link ClaudeEngine}
 *   that {@link ClaudeCodeRuntime}'s methods take instead.
 * - State helpers are imported directly by name from `modkit-claude:state`.
 *
 * @module
 */

import type {
  EngineInterface,
  On,
  RenderInput,
  ToolCallInput,
  ToolCallResult,
  ToolCheckResult,
  Events,
} from 'claude-code'
import { isPlainObject } from 'es-toolkit/predicate'
import { readEnv } from 'modkit-claude:env'
import { bumpView, load, plugin, readView, save } from 'modkit-claude:state'

import {
  dismissed,
  mount,
  nextShown,
  NOTHING_SHOWN,
  type ButtonNode,
  type Harness,
  type HarnessAdapter,
  type Mod,
  type Mounted,
  type Options,
  type Followup,
  type Shown,
  type ShellResult,
  type ToolResult,
  type ToolRow,
  type UiNode,
  type Verdict,
} from '@atuin/modkit'

import { completionOf, mcpResultOf } from './answers'
import { decide, exitCodeOf } from './decide'
import { Drawing } from './draw'

const TICK_MS = 1000

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  isPlainObject(value) ? value : {}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function reporterFor($: EngineInterface): HarnessAdapter['report'] {
  const reported = new Set<string>()
  return ({ phase, error }) => {
    const line = `${plugin}: ${phase} failed: ${messageOf(error)}`
    if (reported.has(line)) return
    reported.add(line)
    $.ui.toast(line)
  }
}

function callsFor($: EngineInterface): Pick<Harness, 'mcp' | 'complete' | 'copy'> {
  return {
    mcp: async ({ server, tool, input }) => {
      try {
        const result =
          input === undefined
            ? await $.mcp.call(server, tool)
            : await $.mcp.call(server, tool, { ...input })
        return mcpResultOf(result)
      } catch (error) {
        return { isOk: false, reason: messageOf(error) }
      }
    },
    complete: async (request) => {
      try {
        return completionOf(await $.model.complete(request))
      } catch (error) {
        return { isAnswered: false, reason: 'refused', detail: messageOf(error) }
      }
    },
    copy: async (text, where) => {
      const surface = where?.surface
      const copied = await $.ui.copy({ text, ...(surface !== undefined && { surface }) })
      return copied.isCopied ? { isCopied: true } : { isCopied: false, reason: copied.reason }
    },
  }
}

async function harnessFor($: EngineInterface): Promise<HarnessAdapter> {
  const stored = await load($)
  const report = reporterFor($)
  return {
    session: { id: await $.session.id() },
    cwd: async () => $.session.cwd(),
    root: async () => $.session.root(),
    env: async (name) => readEnv($, name),
    store: {
      get: (key) => stored.get(key),
      set: (key, value) => {
        stored.set(key, value)
        save($, { key, stored: value }).catch((error: unknown) => {
          report({ phase: 'render', error })
        })
      },
    },
    run: async (argv, options) => {
      const ran = await $.process.run(argv, {
        ...(options?.cwd !== undefined && { cwd: options.cwd }),
        ...(options?.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
      })
      return { exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }
    },
    notify: (text) => {
      $.ui.toast(text)
      return 'now'
    },
    inject: async (text) => {
      const appended = await $.session.append({
        message: { type: 'user', content: [{ type: 'text', text }] },
      })
      return appended.deny === undefined ? 'now' : 'dropped'
    },
    ...callsFor($),
    now: () => Date.now(),
    report,
  }
}

/**
 * The engine calls a hook of the mod makes, bound to that hook's `$`.
 *
 * Claude Code's validator lets a plugin call `$` as `$.noun.method(...)` and pass it only to
 * top-level functions, so {@link ClaudeCodeRuntime} reaches the engine through one of these.
 */
export interface ClaudeEngine {
  readonly harness: () => Promise<HarnessAdapter>
  readonly readView: () => Promise<unknown>
  readonly bumpView: () => Promise<unknown>
  readonly cwd: EngineInterface['session']['cwd']
  readonly toast: EngineInterface['ui']['toast']
  readonly open: EngineInterface['ui']['open']
  readonly close: EngineInterface['ui']['close']
  readonly panes: EngineInterface['ui']['panes']
  readonly resolve: EngineInterface['ui']['resolve']
  readonly register: EngineInterface['command']['register']
  readonly repeat: EngineInterface['clock']['every']
}

/** The {@link ClaudeEngine} of the hook that `$` was handed to. */
export function engineOf($: EngineInterface): ClaudeEngine {
  return {
    harness: async () => harnessFor($),
    readView: async () => readView($),
    bumpView: async () => bumpView($),
    cwd: async () => $.session.cwd(),
    toast: (text) => {
      $.ui.toast(text)
    },
    open: async (pane) => $.ui.open(pane),
    close: async (pane) => $.ui.close(pane),
    panes: async () => $.ui.panes(),
    resolve: (e) => $.ui.resolve(e),
    register: async (command) => $.command.register(command),
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- $.clock.every schedules a tick; it is no array's every
    repeat: (ms, tick) => $.clock.every(ms, tick),
  }
}

const PANE_ID_LENGTH = 64

const paneId = (command: string): string =>
  command.replaceAll(/[^A-Za-z0-9_-]/gu, '-').slice(0, PANE_ID_LENGTH)

type Root = Mod<Options>

// A hook's input, the `next` that hands it on, and its result, as Claude Code declares each event.
type Input<K extends keyof Events> = Events[K][0]
type Next<K extends keyof Events> = (e: Input<K>) => Promise<Events[K][1]>
type Result<K extends keyof Events> = Events[K][1]

// Until session.start builds the adapter, a failure has nowhere to be reported.
const REPORT_NOTHING: HarnessAdapter['report'] = () => undefined

function decided(
  engine: ClaudeEngine,
  { verdict, mine, canAsk }: { verdict: ToolCheckResult; mine: Verdict; canAsk: boolean },
): ToolCheckResult {
  if (mine !== undefined && 'ask' in mine && !canAsk && mine.otherwise === 'allow') {
    engine.toast(mine.ask)
  }
  return decide({ verdict, mine, canAsk })
}

function followedBy(engine: ClaudeEngine, ran: ToolCallResult, followup: Followup): ToolCallResult {
  if (followup.note !== undefined) engine.toast(followup.note)
  if (followup.context === undefined) return ran
  return { ...ran, context: [...(ran.context ?? []), followup.context] }
}

const ENVELOPE = new Set(['tool', 'tool_use_id', 'consent', 'agentId', 'requestMeta'])

const argumentsOf = (e: ToolCallInput): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(e).filter(([key]) => !ENVELOPE.has(key)))

function rowOf(props: RenderInput['props']): ToolRow | undefined {
  const { tool_use_id: id, tool, input, isRunning, isErrored } = props
  if (typeof id !== 'string' || typeof tool !== 'string') return undefined
  return {
    id,
    tool,
    input: recordOf(input),
    isRunning: isRunning === true,
    failed: isErrored === true,
  }
}

/**
 * A mod mounted on Claude Code: the session its hooks share, and what each hook does with it.
 *
 * Each method takes the {@link ClaudeEngine} of the hook it serves, as {@link engineOf} binds it to
 * that hook's `$`.
 */
export class ClaudeCodeRuntime {
  readonly #mod: Root
  readonly #options: Options
  #mounted: Mounted | undefined = undefined
  #report: HarnessAdapter['report'] = REPORT_NOTHING
  #shown: Shown = NOTHING_SHOWN
  // True while a command or a button press runs its synchronous part, up to its first `await`.
  // Background pane syncs wait it out, so a pane it opens opens on the interaction's own `$`,
  // with keyboard focus and the relaxed placement rules an interaction gets.
  #isAnswering = false

  constructor({ mod, options }: { mod: Root; options: Options }) {
    this.#mod = mod
    this.#options = options
  }

  /** The `tool.check` hook for a tool the mod's `beforeTool` names. */
  async checkTool(
    engine: ClaudeEngine,
    e: Input<'tool.check'>,
    next: Next<'tool.check'>,
  ): Promise<Result<'tool.check'>> {
    const verdict = await next(e)
    const mounted = this.#mounted
    if (mounted === undefined) return verdict
    const input = recordOf(e.input)
    const call = { id: e.tool_use_id ?? '', tool: e.tool, input, cwd: await engine.cwd() }
    return decided(engine, {
      verdict,
      mine: await mounted.beforeTool(call),
      canAsk: e.approver !== undefined,
    })
  }

  /** The `tool.call` hook for a tool the mod's `afterTool` names. */
  async callTool(
    engine: ClaudeEngine,
    e: Input<'tool.call'>,
    next: Next<'tool.call'>,
  ): Promise<Result<'tool.call'>> {
    const ran = await next(e)
    const mounted = this.#mounted
    if (mounted === undefined || ran.deny !== undefined) return ran
    const result: ToolResult = {
      id: e.tool_use_id ?? '',
      tool: e.tool,
      input: argumentsOf(e),
      cwd: await engine.cwd(),
      output: ran.text ?? '',
      failed: ran.isError === true,
    }
    return followedBy(engine, ran, await mounted.afterTool(result))
  }

  /** The `ui.render` hook for the rows of a tool the mod's `toolCards` names. */
  async renderCards(
    engine: ClaudeEngine,
    e: Input<'ui.render'>,
    next: Next<'ui.render'>,
  ): Promise<Result<'ui.render'>> {
    await engine.readView()
    const row = rowOf(e.props)
    const cards = row === undefined ? [] : (this.#mounted?.cards(row) ?? [])
    if (cards.length === 0) return next(e)
    const drawn = await next(e)
    const under = this.#drawingFor(engine, e).nodes(cards, 'card')
    return h(engine.resolve(e).Box, { flexDirection: 'column' }, drawn, ...under)
  }

  async #start(engine: ClaudeEngine): Promise<void> {
    const adapter = await engine.harness()
    this.#report = (failure) => {
      adapter.report(failure)
    }
    this.#shown = NOTHING_SHOWN
    const mounted = mount({ mod: this.#mod, options: this.#options, adapter })
    this.#mounted = mounted
    mounted.subscribe(() => {
      void engine.bumpView()
      if (!this.#isAnswering) this.#syncPanes(engine, false)
    })
    this.#syncPanes(engine, false)
    for (const command of mounted.view().commands) {
      // oxlint-disable-next-line no-await-in-loop -- the engine takes registrations one at a time
      await engine.register({ name: command.name, description: command.description })
    }
    engine.repeat(TICK_MS, () => {
      void mounted.tick()
    })
    await mounted.event('session.start')
    await engine.bumpView()
  }

  #syncPanes(engine: ClaudeEngine, isPress: boolean): void {
    const mounted = this.#mounted
    if (mounted === undefined) return
    const { shown, changes } = nextShown({ shown: this.#shown, rendered: mounted.view().panes })
    // Kept before any call goes out, so a render while they're under way sees them made.
    this.#shown = shown
    const fail = (error: unknown): void => {
      this.#report({ phase: 'render', error })
    }
    for (const change of changes) {
      if (change.kind === 'close') {
        engine.close({ id: change.id }).catch(fail)
        continue
      }
      const { id, title } = change
      const focus = isPress ? { focus: true as const } : {}
      engine.open({ id, title, ...focus }).catch(fail)
    }
  }

  async #answering<T>(engine: ClaudeEngine, start: () => Promise<T>): Promise<T> {
    this.#isAnswering = true
    // oxlint-disable-next-line typescript/promise-function-async -- answering is only start's synchronous part, up to its first await
    const done = (() => {
      try {
        return start()
      } finally {
        this.#isAnswering = false
      }
    })()
    this.#syncPanes(engine, true)
    return done
  }

  // A Drawing for the surface `e` renders on, whose buttons press on that hook's `$`.
  #drawingFor(engine: ClaudeEngine, e: RenderInput): Drawing {
    return new Drawing({
      elements: engine.resolve(e),
      press: (button: ButtonNode): void => {
        void this.#answering(engine, async () => button.press({ surface: e.surface }))
      },
    })
  }

  #paneBody(id: string): readonly UiNode[] | undefined {
    const view = this.#mounted?.view()
    const command = view?.commands.find((one) => paneId(one.name) === id)
    return command?.pane?.body ?? view?.panes.find((pane) => pane.id === id)?.body
  }

  /** The `session.start` hook: mount the mod, register its commands and start its tick. */
  async startSession(
    engine: ClaudeEngine,
    e: Input<'session.start'>,
    next: Next<'session.start'>,
  ): Promise<Result<'session.start'>> {
    const started = await next(e)
    await this.#start(engine)
    return started
  }

  /** The `turn.complete` hook: tell the mod a turn ended. */
  async completeTurn(
    _engine: ClaudeEngine,
    e: Input<'turn.complete'>,
    next: Next<'turn.complete'>,
  ): Promise<Result<'turn.complete'>> {
    const completed = await next(e)
    void this.#mounted?.event('turn.end')
    return completed
  }

  /** The `ui.close` hook: keep a pane the person closed closed, and tell the mod. */
  async closeUi(
    _engine: ClaudeEngine,
    e: Input<'ui.close'>,
    next: Next<'ui.close'>,
  ): Promise<Result<'ui.close'>> {
    const closed = await next(e)
    if (e.origin.kind !== 'person' || !this.#shown.open.has(e.id)) return closed
    this.#shown = dismissed({ shown: this.#shown, id: e.id })
    await this.#mounted?.closed(e.id)
    return closed
  }

  /** The `tool.check` hook for Bash: the mod's `beforeShell` verdict. */
  async checkShell(
    engine: ClaudeEngine,
    e: Input<'tool.check'>,
    next: Next<'tool.check'>,
  ): Promise<Result<'tool.check'>> {
    const verdict = await next(e)
    const mounted = this.#mounted
    const { command } = recordOf(e.input)
    if (mounted === undefined || typeof command !== 'string') return verdict
    const call = { id: e.tool_use_id ?? '', command, cwd: await engine.cwd() }
    return decided(engine, {
      verdict,
      mine: await mounted.beforeShell(call),
      canAsk: e.approver !== undefined,
    })
  }

  /** The `tool.call` hook for Bash: the mod's `afterShell` followup. */
  async callShell(
    engine: ClaudeEngine,
    e: Input<'tool.call'>,
    next: Next<'tool.call'>,
  ): Promise<Result<'tool.call'>> {
    const ran = await next(e)
    const mounted = this.#mounted
    if (mounted === undefined || ran.deny !== undefined || typeof e.command !== 'string') {
      return ran
    }
    const result: ShellResult = {
      id: e.tool_use_id ?? '',
      command: e.command,
      cwd: await engine.cwd(),
      output: ran.text ?? '',
      exitCode: exitCodeOf(ran),
      failed: ran.isError === true,
    }
    return followedBy(engine, ran, await mounted.afterShell(result))
  }

  /** The `ui.render` hook for the session's mode line, which the mod's statuses follow. */
  async renderStatus(
    engine: ClaudeEngine,
    e: Input<'ui.render'>,
    next: Next<'ui.render'>,
  ): Promise<Result<'ui.render'>> {
    await engine.readView()
    const statuses = this.#mounted?.view().statuses ?? []
    if (statuses.length === 0) return next(e)
    const elements = engine.resolve(e)
    const modes = await next(e)
    const drawing = this.#drawingFor(engine, e)
    const drawn = statuses.map((status, index) => {
      const key = `status.${index}`
      return h(elements.Box, { key, flexDirection: 'row' }, ...drawing.nodes(status, key))
    })
    const hasModes = Array.isArray(e.props['modes']) && e.props['modes'].length > 0
    const between = hasModes ? [h(elements.Text, { key: 'modes.after', dimColor: true }, '·')] : []
    return h(elements.Box, { flexDirection: 'row', gap: 1 }, modes, ...between, ...drawn)
  }

  /** The `ui.render` hook for a pane, which draws the body of one of the mod's. */
  async renderPane(
    engine: ClaudeEngine,
    e: Input<'ui.render'>,
    next: Next<'ui.render'>,
  ): Promise<Result<'ui.render'>> {
    await engine.readView()
    const body = this.#paneBody(e.requestId)
    if (body === undefined) return next(e)
    const elements = engine.resolve(e)
    return h(elements.Box, { flexDirection: 'column' }, ...this.#drawingFor(engine, e).nodes(body))
  }

  /** The `command.run` hook: run one of the mod's commands, or toggle its pane. */
  async runCommand(
    engine: ClaudeEngine,
    e: Input<'command.run'>,
    next: Next<'command.run'>,
  ): Promise<Result<'command.run'>> {
    const mounted = this.#mounted
    const command = mounted?.view().commands.find((one) => one.name === e.command)
    if (mounted === undefined || command === undefined) return next(e)
    if (command.pane === undefined) {
      const said = await this.#answering(engine, async () => mounted.ran(command.name))
      return { text: said ?? '' }
    }
    const id = paneId(command.name)
    const { title } = command.pane
    const panes = await engine.panes()
    if (panes.some((pane) => pane.id === id && pane.isShown)) {
      await engine.close({ id })
      return { text: `${title} closed.` }
    }
    const opened = await engine.open({ id, title, focus: true })
    return { text: opened.isPlaced ? `${title} opened.` : `${title} waits: ${opened.reason}` }
  }
}

/**
 * Register the hooks every mod takes, each one a method of `runtime` given the hook's engine.
 *
 * A top-level function, since Claude Code's validator lets `on` and `$` be passed only to one.
 */
export function registerHooks(on: On, runtime: ClaudeCodeRuntime): void {
  on('session.start', async ($, e, next) => runtime.startSession(engineOf($), e, next))
  on('turn.complete', async ($, e, next) => runtime.completeTurn(engineOf($), e, next))
  on('ui.close', async ($, e, next) => runtime.closeUi(engineOf($), e, next)).catch(
    async (_$, e, next) => next(e),
  )
  on('tool.check', { tool: 'Bash' }, async ($, e, next) =>
    runtime.checkShell(engineOf($), e, next),
  ).catch(async (_$, e, next) => next(e))
  on('tool.call', { tool: 'Bash' }, async ($, e, next) =>
    runtime.callShell(engineOf($), e, next),
  ).catch(async (_$, e, next) => next(e))
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) =>
    runtime.renderStatus(engineOf($), e, next),
  )
  on('ui.render', { component: 'Pane' }, async ($, e, next) =>
    runtime.renderPane(engineOf($), e, next),
  )
  on('command.run', async ($, e, next) => runtime.runCommand(engineOf($), e, next)).catch(
    async (_$, e, next) => next(e),
  )
}
