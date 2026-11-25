/**
 * Claude Code runtime adapter that mounts a modkit mod onto Claude Code's hook engine.
 *
 * Lifecycle:
 * - On `session.start`, preloads persisted state atoms into memory (so synchronous renders can
 *   read state without awaiting), mounts the mod, registers slash commands, starts a 1s resource
 *   tick, and bumps the view atom on every state-driven re-render so `ui.render` hooks redraw.
 * - Decision hooks fail open via `.catch((_, e, next) => next(e))` so mod faults never block the
 *   agent.
 *
 * Validator constraints (`claude plugin validate`):
 * - `on` is only called directly or passed as a plain argument.
 * - `$` is only accessed as `$.noun.method(...)` or passed as a bare argument to functions inside
 *   the bundle.
 * - State helpers are imported directly by name from `modkit-claude:state`.
 *
 * @module
 */

import type {
  EngineInterface,
  On,
  RenderInput,
  RenderNode,
  ToolCallInput,
  ToolCallResult,
  ToolCheckInput,
  ToolCheckResult,
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
  type Surface,
  type ToolResult,
  type ToolRow,
  type UiNode,
  type Verdict,
} from '@atuin/modkit'

import { completionOf, mcpResultOf } from './answers'
import { decide, exitCodeOf } from './decide'
import { draw } from './draw'

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
 * Module-scoped state for the single mounted mod in this plugin bundle.
 *
 * Shared across hooks registered by codegen (`checkTool`, `callTool`, `drawCards`) and core hooks.
 */
interface Live {
  mounted: Mounted | undefined
  report: HarnessAdapter['report']
  shown: Shown
  /**
   * True while running a user-triggered command or button press synchronously (up to its first
   * `await`). Suppresses background `syncPanes` so newly opened panes open on the interaction's
   * own `$` with keyboard focus and relaxed placement rules.
   */
  isAnswering: boolean
}

const live: Live = {
  mounted: undefined,
  report: () => undefined,
  shown: NOTHING_SHOWN,
  isAnswering: false,
}

function syncPanes($: EngineInterface, isPress: boolean): void {
  const { mounted } = live
  if (mounted === undefined) return
  const { shown, changes } = nextShown({ shown: live.shown, rendered: mounted.view().panes })
  // Kept before any call goes out, so a render while they're under way sees them made.
  live.shown = shown
  const fail = (error: unknown): void => {
    live.report({ phase: 'render', error })
  }
  for (const change of changes) {
    if (change.kind === 'close') {
      $.ui.close({ id: change.id }).catch(fail)
      continue
    }
    const { id, title } = change
    const focus = isPress ? { focus: true as const } : {}
    $.ui.open({ id, title, ...focus }).catch(fail)
  }
}

async function answering<T>($: EngineInterface, start: () => Promise<T>): Promise<T> {
  live.isAnswering = true
  // oxlint-disable-next-line typescript/promise-function-async -- answering is only start's synchronous part, up to its first await
  const done = (() => {
    try {
      return start()
    } finally {
      live.isAnswering = false
    }
  })()
  syncPanes($, true)
  return done
}

function pressOn($: EngineInterface, button: ButtonNode, surface: Surface): void {
  void answering($, async () => button.press({ surface }))
}

const PANE_ID_LENGTH = 64

const paneId = (command: string): string =>
  command.replaceAll(/[^A-Za-z0-9_-]/gu, '-').slice(0, PANE_ID_LENGTH)

type Root = Mod<Options>

function registerSession(on: On, { mod, options }: { mod: Root; options: Options }): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const adapter = await harnessFor($)
    live.report = (failure) => {
      adapter.report(failure)
    }
    live.shown = NOTHING_SHOWN
    const mounted = mount({ mod, options, adapter })
    live.mounted = mounted
    mounted.subscribe(() => {
      void bumpView($)
      if (!live.isAnswering) syncPanes($, false)
    })
    syncPanes($, false)
    for (const command of mounted.view().commands) {
      // oxlint-disable-next-line no-await-in-loop -- the engine takes registrations one at a time
      await $.command.register({ name: command.name, description: command.description })
    }
    // oxlint-disable-next-line unicorn/no-array-method-this-argument -- $.clock.every schedules a tick; it is no array's every
    $.clock.every(TICK_MS, () => {
      void mounted.tick()
    })
    await mounted.event('session.start')
    await bumpView($)
    return started
  })

  on('turn.complete', async (_$, e, next) => {
    const completed = await next(e)
    void live.mounted?.event('turn.end')
    return completed
  })

  on('ui.close', async (_$, e, next) => {
    const closed = await next(e)
    if (e.origin.kind !== 'person' || !live.shown.open.has(e.id)) return closed
    live.shown = dismissed({ shown: live.shown, id: e.id })
    await live.mounted?.closed(e.id)
    return closed
  }).catch(async (_$, e, next) => next(e))
}

function registerShell(on: On): void {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const verdict = await next(e)
    const { mounted } = live
    const { command } = recordOf(e.input)
    if (mounted === undefined || typeof command !== 'string') return verdict
    const call = { id: e.tool_use_id ?? '', command, cwd: await $.session.cwd() }
    return decided($, {
      verdict,
      mine: await mounted.beforeShell(call),
      canAsk: e.approver !== undefined,
    })
  }).catch(async (_$, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const { mounted } = live
    if (mounted === undefined || ran.deny !== undefined || typeof e.command !== 'string') return ran
    const result: ShellResult = {
      id: e.tool_use_id ?? '',
      command: e.command,
      cwd: await $.session.cwd(),
      output: ran.text ?? '',
      exitCode: exitCodeOf(ran),
      failed: ran.isError === true,
    }
    return followedBy($, ran, await mounted.afterShell(result))
  }).catch(async (_$, e, next) => next(e))
}

function decided(
  $: EngineInterface,
  { verdict, mine, canAsk }: { verdict: ToolCheckResult; mine: Verdict; canAsk: boolean },
): ToolCheckResult {
  if (mine !== undefined && 'ask' in mine && !canAsk && mine.otherwise === 'allow') {
    $.ui.toast(mine.ask)
  }
  return decide({ verdict, mine, canAsk })
}

function followedBy($: EngineInterface, ran: ToolCallResult, followup: Followup): ToolCallResult {
  if (followup.note !== undefined) $.ui.toast(followup.note)
  if (followup.context === undefined) return ran
  return { ...ran, context: [...(ran.context ?? []), followup.context] }
}

const ENVELOPE = new Set(['tool', 'tool_use_id', 'consent', 'agentId', 'requestMeta'])

const argumentsOf = (e: ToolCallInput): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(e).filter(([key]) => !ENVELOPE.has(key)))

export async function checkTool(
  $: EngineInterface,
  e: ToolCheckInput,
  next: (e: ToolCheckInput) => Promise<ToolCheckResult>,
): Promise<ToolCheckResult> {
  const verdict = await next(e)
  const { mounted } = live
  if (mounted === undefined) return verdict
  const input = recordOf(e.input)
  const call = { id: e.tool_use_id ?? '', tool: e.tool, input, cwd: await $.session.cwd() }
  return decided($, {
    verdict,
    mine: await mounted.beforeTool(call),
    canAsk: e.approver !== undefined,
  })
}

export async function callTool(
  $: EngineInterface,
  e: ToolCallInput,
  next: (e: ToolCallInput) => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  const ran = await next(e)
  const { mounted } = live
  if (mounted === undefined || ran.deny !== undefined) return ran
  const result: ToolResult = {
    id: e.tool_use_id ?? '',
    tool: e.tool,
    input: argumentsOf(e),
    cwd: await $.session.cwd(),
    output: ran.text ?? '',
    failed: ran.isError === true,
  }
  return followedBy($, ran, await mounted.afterTool(result))
}

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

export async function drawCards(
  $: EngineInterface,
  e: RenderInput,
  next: (e: RenderInput) => Promise<RenderNode>,
): Promise<RenderNode> {
  await readView($)
  const row = rowOf(e.props)
  const cards = row === undefined ? [] : (live.mounted?.cards(row) ?? [])
  if (cards.length === 0) return next(e)
  const elements = $.ui.resolve(e)
  const drawn = await next(e)
  const press = (button: ButtonNode): void => {
    pressOn($, button, e.surface)
  }
  const under = draw({ elements, nodes: cards, press, at: 'card' })
  return h(elements.Box, { flexDirection: 'column' }, drawn, ...under)
}

function paneBody(id: string): readonly UiNode[] | undefined {
  const view = live.mounted?.view()
  const command = view?.commands.find((one) => paneId(one.name) === id)
  return command?.pane?.body ?? view?.panes.find((pane) => pane.id === id)?.body
}

function registerDrawing(on: On): void {
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    await readView($)
    const statuses = live.mounted?.view().statuses ?? []
    if (statuses.length === 0) return next(e)
    const elements = $.ui.resolve(e)
    const modes = await next(e)
    const press = (button: ButtonNode): void => {
      pressOn($, button, e.surface)
    }
    const drawn = statuses.map((status, index) => {
      const key = `status.${index}`
      return h(
        elements.Box,
        { key, flexDirection: 'row' },
        ...draw({ elements, nodes: status, press, at: key }),
      )
    })
    const hasModes = Array.isArray(e.props['modes']) && e.props['modes'].length > 0
    const between = hasModes ? [h(elements.Text, { key: 'modes.after', dimColor: true }, '·')] : []
    return h(elements.Box, { flexDirection: 'row', gap: 1 }, modes, ...between, ...drawn)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    await readView($)
    const body = paneBody(e.requestId)
    if (body === undefined) return next(e)
    const elements = $.ui.resolve(e)
    const press = (button: ButtonNode): void => {
      pressOn($, button, e.surface)
    }
    return h(elements.Box, { flexDirection: 'column' }, ...draw({ elements, nodes: body, press }))
  })
}

function registerCommands(on: On): void {
  on('command.run', async ($, e, next) => {
    const { mounted } = live
    const command = mounted?.view().commands.find((one) => one.name === e.command)
    if (mounted === undefined || command === undefined) return next(e)
    if (command.pane === undefined) {
      const said = await answering($, async () => mounted.ran(command.name))
      return { text: said ?? '' }
    }
    const id = paneId(command.name)
    const { title } = command.pane
    const panes = await $.ui.panes()
    if (panes.some((pane) => pane.id === id && pane.isShown)) {
      await $.ui.close({ id })
      return { text: `${title} closed.` }
    }
    const opened = await $.ui.open({ id, title, focus: true })
    return { text: opened.isPlaced ? `${title} opened.` : `${title} waits: ${opened.reason}` }
  }).catch(async (_$, e, next) => next(e))
}

export function registerHooks(on: On, mod: Root, options: Options): void {
  registerSession(on, { mod, options })
  registerShell(on)
  registerDrawing(on)
  registerCommands(on)
}
