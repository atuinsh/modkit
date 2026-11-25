/**
 * Claude Code runtime adapter that mounts a modkit mod onto Claude Code's hook engine.
 *
 * Lifecycle:
 * - The generated entry module makes one {@link ClaudeCodeRuntime} and registers its hooks.
 * - On `session.start`, preloads persisted state atoms into memory (so synchronous renders can
 *   read state without awaiting), then starts the session `ModkitTargetRuntime` runs: Claude Code
 *   registers its slash commands, ticks it, and bumps the view atom on every state-driven
 *   re-render so `ui.render` hooks redraw.
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
  ModkitTargetRuntime,
  type ButtonNode,
  type CommandView,
  type Followup,
  type Harness,
  type HarnessAdapter,
  type PaneOpened,
  type PaneOpening,
  type Repeat,
  type ShellResult,
  type ToolResult,
  type ToolRow,
  type Verdict,
} from '@atuin/modkit-target/host'

import { completionOf, mcpResultOf } from './answers'
import { decide, exitCodeOf } from './decide'
import { Drawing } from './draw'

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

// A hook's input, the `next` that hands it on, and its result, as Claude Code declares each event.
type Input<K extends keyof Events> = Events[K][0]
type Next<K extends keyof Events> = (e: Input<K>) => Promise<Events[K][1]>
type Result<K extends keyof Events> = Events[K][1]

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
 * A mod's session on Claude Code: what each of Claude Code's hooks asks of the session, and how
 * Claude Code does what the session needs.
 *
 * Each method takes the {@link ClaudeEngine} of the hook it serves, as {@link engineOf} binds it to
 * that hook's `$`.
 */
export class ClaudeCodeRuntime extends ModkitTargetRuntime<ClaudeEngine> {
  /** The `tool.check` hook for a tool the mod's `beforeTool` names. */
  async checkTool(
    engine: ClaudeEngine,
    e: Input<'tool.check'>,
    next: Next<'tool.check'>,
  ): Promise<Result<'tool.check'>> {
    const verdict = await next(e)
    if (!this.hasStarted) return verdict
    const input = recordOf(e.input)
    const call = { id: e.tool_use_id ?? '', tool: e.tool, input, cwd: await engine.cwd() }
    return decided(engine, {
      verdict,
      mine: await this.beforeTool(call),
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
    if (!this.hasStarted || ran.deny !== undefined) return ran
    const result: ToolResult = {
      id: e.tool_use_id ?? '',
      tool: e.tool,
      input: argumentsOf(e),
      cwd: await engine.cwd(),
      output: ran.text ?? '',
      failed: ran.isError === true,
    }
    return followedBy(engine, ran, await this.afterTool(result))
  }

  /** The `ui.render` hook for the rows of a tool the mod's `toolCards` names. */
  async renderCards(
    engine: ClaudeEngine,
    e: Input<'ui.render'>,
    next: Next<'ui.render'>,
  ): Promise<Result<'ui.render'>> {
    await engine.readView()
    const row = rowOf(e.props)
    const cards = row === undefined ? [] : this.cards(row)
    if (cards.length === 0) return next(e)
    const drawn = await next(e)
    const under = this.#drawingFor(engine, e).nodes(cards, 'card')
    return h(engine.resolve(e).Box, { flexDirection: 'column' }, drawn, ...under)
  }

  /** The `session.start` hook: mount the mod, register its commands and start its tick. */
  async startSession(
    engine: ClaudeEngine,
    e: Input<'session.start'>,
    next: Next<'session.start'>,
  ): Promise<Result<'session.start'>> {
    const started = await next(e)
    await this.start(engine)
    return started
  }

  /** The `turn.complete` hook: tell the mod a turn ended. */
  async completeTurn(
    _engine: ClaudeEngine,
    e: Input<'turn.complete'>,
    next: Next<'turn.complete'>,
  ): Promise<Result<'turn.complete'>> {
    const completed = await next(e)
    this.turnEnded()
    return completed
  }

  /** The `ui.close` hook: keep a pane the person closed closed, and tell the mod. */
  async closeUi(
    _engine: ClaudeEngine,
    e: Input<'ui.close'>,
    next: Next<'ui.close'>,
  ): Promise<Result<'ui.close'>> {
    const closed = await next(e)
    if (e.origin.kind === 'person') await this.dismiss(e.id)
    return closed
  }

  /** The `tool.check` hook for Bash: the mod's `beforeShell` verdict. */
  async checkShell(
    engine: ClaudeEngine,
    e: Input<'tool.check'>,
    next: Next<'tool.check'>,
  ): Promise<Result<'tool.check'>> {
    const verdict = await next(e)
    const { command } = recordOf(e.input)
    if (!this.hasStarted || typeof command !== 'string') return verdict
    const call = { id: e.tool_use_id ?? '', command, cwd: await engine.cwd() }
    return decided(engine, {
      verdict,
      mine: await this.beforeShell(call),
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
    if (!this.hasStarted || ran.deny !== undefined || typeof e.command !== 'string') return ran
    const result: ShellResult = {
      id: e.tool_use_id ?? '',
      command: e.command,
      cwd: await engine.cwd(),
      output: ran.text ?? '',
      exitCode: exitCodeOf(ran),
      failed: ran.isError === true,
    }
    return followedBy(engine, ran, await this.afterShell(result))
  }

  /** The `ui.render` hook for the session's mode line, which the mod's statuses follow. */
  async renderStatus(
    engine: ClaudeEngine,
    e: Input<'ui.render'>,
    next: Next<'ui.render'>,
  ): Promise<Result<'ui.render'>> {
    await engine.readView()
    const statuses = this.statuses()
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
    const body = this.paneBody(e.requestId)
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
    const reply = await this.answerCommand(engine, e.command)
    return reply === undefined ? next(e) : { text: reply }
  }

  protected override async adapter(engine: ClaudeEngine): Promise<HarnessAdapter> {
    return engine.harness()
  }

  protected override async redraw(engine: ClaudeEngine): Promise<unknown> {
    return engine.bumpView()
  }

  protected override async openPane(
    engine: ClaudeEngine,
    { id, title, focus }: PaneOpening,
  ): Promise<PaneOpened> {
    return engine.open({ id, title, ...(focus && { focus }) })
  }

  protected override async closePane(engine: ClaudeEngine, id: string): Promise<unknown> {
    return engine.close({ id })
  }

  protected override async isPaneShown(engine: ClaudeEngine, id: string): Promise<boolean> {
    const panes = await engine.panes()
    return panes.some((pane) => pane.id === id && pane.isShown)
  }

  protected override async registerCommand(
    engine: ClaudeEngine,
    { name, description }: CommandView,
  ): Promise<unknown> {
    return engine.register({ name, description })
  }

  protected override repeat(engine: ClaudeEngine, { everyMs, tick }: Repeat): void {
    engine.repeat(everyMs, tick)
  }

  // A Drawing for the surface `e` renders on, whose buttons press on that hook's `$`.
  #drawingFor(engine: ClaudeEngine, e: RenderInput): Drawing {
    return new Drawing({
      elements: engine.resolve(e),
      press: (button: ButtonNode): void => {
        this.press(engine, { button, surface: e.surface })
      },
    })
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
