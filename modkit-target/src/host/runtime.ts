import type {
  Followup,
  Mod,
  Options,
  ShellCall,
  ShellResult,
  Surface,
  ToolCall,
  ToolResult,
  ToolRow,
  Verdict,
} from '@atuin/modkit'
import {
  dismissed,
  mount,
  nextShown,
  NOTHING_SHOWN,
  type ButtonNode,
  type CommandView,
  type HarnessAdapter,
  type Mounted,
  type Shown,
  type UiNode,
} from '@atuin/modkit/host'

// How often a session refreshes the mod's resources.
const TICK_MS = 1000

// Until a session starts, a failure has nowhere to be reported.
const REPORT_NOTHING: HarnessAdapter['report'] = () => undefined

// What a tool call is followed by while no session started.
const NO_FOLLOWUP: Followup = {}

// A pane id's limit, as `<Pane id>` takes one: 1 to 64 letters, digits, `_` or `-`.
const PANE_ID_LENGTH = 64

// The id of the pane `command` toggles: its name, in the characters a pane id takes.
const paneIdOf = (command: string): string =>
  command.replaceAll(/[^A-Za-z0-9_-]/gu, '-').slice(0, PANE_ID_LENGTH)

/** A pane of the mod's, as a target's harness opens it. */
export interface PaneOpening {
  id: string
  title: string
  /** Whether the pane takes the keyboard: true when an interaction of the person's opened it. */
  focus: boolean
}

/** Whether a target's harness placed a pane it was asked to open, or why it waits. */
export type PaneOpened = { isPlaced: true } | { isPlaced: false; reason: string }

/** A callback a target's harness calls every `everyMs`. */
export interface Repeat {
  everyMs: number
  tick: () => void
}

/** A button of the mod's, pressed on `surface`. */
export interface ButtonPress {
  button: ButtonNode
  surface: Surface
}

/** A shell or tool call intercepted before execution. */
export type HookedCall =
  | ({ readonly kind: 'shell' } & ShellCall)
  | ({ readonly kind: 'tool' } & ToolCall)

/** A shell or tool result intercepted after execution. */
export type HookedResult =
  | ({ readonly kind: 'shell' } & ShellResult)
  | ({ readonly kind: 'tool' } & ToolResult)

/**
 * A mod's session, which every target runs the same way: it mounts the mod when the session starts,
 * keeps the panes the mod shows open, ticks it, and answers the harness's hooks and the person's
 * commands and button presses.
 *
 * A target extends it with how its harness does what a session needs: the {@link HarnessAdapter}
 * the mod's handlers call, a redraw, a pane opened, closed or looked up, a command registered, and
 * a tick. Its hooks call the session methods, which are the same for every target: a target
 * implements the abstract methods and overrides none of the rest. `Engine` is what the harness
 * hands each of the target's hooks to reach it with, and each method that reaches the harness
 * takes the engine of the hook it serves.
 */
export abstract class ModkitTargetRuntime<Engine> {
  readonly #mod: Mod<Options>
  readonly #options: Options
  #mounted: Mounted | undefined = undefined
  #report: HarnessAdapter['report'] = REPORT_NOTHING
  #shown: Shown = NOTHING_SHOWN
  // True while a command or a button press runs its synchronous part, up to its first `await`.
  // Background pane syncs wait it out, so a pane it opens opens on the interaction's own engine,
  // with keyboard focus and the relaxed placement rules an interaction gets.
  #isAnswering = false

  constructor({ mod, options }: { mod: Mod<Options>; options: Options }) {
    this.#mod = mod
    this.#options = options
  }

  /** Whether the session started, so the mod answers the harness's hooks. */
  protected get hasStarted(): boolean {
    return this.#mounted !== undefined
  }

  /** The adapter the mod's handlers reach the harness through for the session. */
  protected abstract adapter(engine: Engine): Promise<HarnessAdapter>

  /** Have the harness draw the mod's view again. */
  protected abstract redraw(engine: Engine): Promise<unknown>

  /** Show one of the mod's panes, or retitle it when it shows. */
  protected abstract openPane(engine: Engine, pane: PaneOpening): Promise<PaneOpened>

  /** Take down one of the mod's panes. */
  protected abstract closePane(engine: Engine, id: string): Promise<unknown>

  /** Whether the harness shows pane `id`. */
  protected abstract isPaneShown(engine: Engine, id: string): Promise<boolean>

  /** Make one of the mod's commands one the person can run. */
  protected abstract registerCommand(engine: Engine, command: CommandView): Promise<unknown>

  /** Have the harness call `repeat.tick` every `repeat.everyMs` for the rest of the session. */
  protected abstract repeat(engine: Engine, repeat: Repeat): void

  /**
   * Mount the mod for a session that started: register its commands, show its panes, start its
   * tick, and redraw the harness each time its state changes.
   */
  protected async start(engine: Engine): Promise<void> {
    const adapter = await this.adapter(engine)
    this.#report = (failure) => {
      adapter.report(failure)
    }
    this.#shown = NOTHING_SHOWN
    const mounted = mount({ mod: this.#mod, options: this.#options, adapter })
    this.#mounted = mounted
    mounted.subscribe(() => {
      void this.redraw(engine)
      if (!this.#isAnswering) this.#syncPanes(engine, false)
    })
    this.#syncPanes(engine, false)
    for (const command of mounted.view().commands) {
      // oxlint-disable-next-line no-await-in-loop -- a harness takes registrations one at a time
      await this.registerCommand(engine, command)
    }
    this.repeat(engine, {
      everyMs: TICK_MS,
      tick: () => {
        void mounted.tick()
      },
    })
    await mounted.event('session.start')
    await this.redraw(engine)
  }

  /** A turn of the session's ended: refresh what the mod reads on one, without holding the turn. */
  protected turnEnded(): void {
    void this.#mounted?.event('turn.end')
  }

  /** The mod's verdict on a shell command before it runs. */
  protected async beforeShell(call: ShellCall): Promise<Verdict> {
    return this.#mounted?.beforeShell(call)
  }

  /** What the mod follows a shell command's result with. */
  protected async afterShell(result: ShellResult): Promise<Followup> {
    return (await this.#mounted?.afterShell(result)) ?? NO_FOLLOWUP
  }

  /** The mod's verdict on a tool call before it runs. */
  protected async beforeTool(call: ToolCall): Promise<Verdict> {
    return this.#mounted?.beforeTool(call)
  }

  /** What the mod follows a tool call's result with. */
  protected async afterTool(result: ToolResult): Promise<Followup> {
    return (await this.#mounted?.afterTool(result)) ?? NO_FOLLOWUP
  }

  /** Route a shell or tool call to `beforeShell` or `beforeTool`. */
  protected async verdictFor(call: HookedCall): Promise<Verdict> {
    return call.kind === 'shell' ? this.beforeShell(call) : this.beforeTool(call)
  }

  /** Route a shell or tool result to `afterShell` or `afterTool`. */
  protected async followupFor(result: HookedResult): Promise<Followup> {
    return result.kind === 'shell' ? this.afterShell(result) : this.afterTool(result)
  }

  /** The cards the mod draws under a row of the session's tool calls. */
  protected cards(row: ToolRow): readonly UiNode[] {
    return this.#mounted?.cards(row) ?? []
  }

  /** The mod's statuses, one row of nodes each. */
  protected statuses(): readonly (readonly UiNode[])[] {
    return this.#mounted?.view().statuses ?? []
  }

  /** The body of pane `id`, one a command toggles or one the mod shows. */
  protected paneBody(id: string): readonly UiNode[] | undefined {
    const view = this.#mounted?.view()
    const command = view?.commands.find((one) => paneIdOf(one.name) === id)
    return command?.pane?.body ?? view?.panes.find((pane) => pane.id === id)?.body
  }

  /**
   * Answer the person running command `name`: run it, or close the pane it toggles when that shows
   * and open it otherwise. The reply to tell them, or undefined when the mod has no command `name`.
   */
  protected async answerCommand(engine: Engine, name: string): Promise<string | undefined> {
    const mounted = this.#mounted
    const command = mounted?.view().commands.find((one) => one.name === name)
    if (mounted === undefined || command === undefined) return undefined
    if (command.pane === undefined) {
      return (await this.#answering(engine, async () => mounted.ran(name))) ?? ''
    }
    return this.#toggled(engine, { id: paneIdOf(name), title: command.pane.title })
  }

  /** Answer the person pressing one of the mod's buttons, on the engine of the hook that drew it. */
  protected press(engine: Engine, { button, surface }: ButtonPress): void {
    void this.#answering(engine, async () => button.press({ surface }))
  }

  /** The person closed pane `id`: keep it closed while the mod shows it, and tell the mod. */
  protected async dismiss(id: string): Promise<void> {
    if (!this.#shown.open.has(id)) return
    this.#shown = dismissed({ shown: this.#shown, id })
    await this.#mounted?.closed(id)
  }

  // Answer an interaction of the person's with `start`, the handler it runs: the panes its
  // synchronous part shows open on `engine`, the interaction's, and take the keyboard.
  async #answering<T>(engine: Engine, start: () => Promise<T>): Promise<T> {
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

  async #toggled(engine: Engine, { id, title }: { id: string; title: string }): Promise<string> {
    if (await this.isPaneShown(engine, id)) {
      await this.closePane(engine, id)
      return `${title} closed.`
    }
    const opened = await this.openPane(engine, { id, title, focus: true })
    return opened.isPlaced ? `${title} opened.` : `${title} waits: ${opened.reason}`
  }

  #syncPanes(engine: Engine, isAnswer: boolean): void {
    const mounted = this.#mounted
    if (mounted === undefined) return
    const { shown, changes } = nextShown({ shown: this.#shown, rendered: mounted.view().panes })
    // Kept before any call goes out, so a render while they're under way sees them made.
    this.#shown = shown
    const fail = (error: unknown): void => {
      this.#report({ phase: 'render', error })
    }
    for (const change of changes) {
      const changed =
        change.kind === 'close'
          ? this.closePane(engine, change.id)
          : this.openPane(engine, { id: change.id, title: change.title, focus: isAnswer })
      changed.catch(fail)
    }
  }
}
