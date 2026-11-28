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
  PaneId,
  type ButtonNode,
  type HarnessAdapter,
  type Images,
  type Mounted,
  type Shown,
  type UiNode,
} from '@atuin/modkit/host'

import type { Capabilities } from './capabilities.ts'
import {
  NOP_COMMAND_HOST,
  NOP_VIEW_HOST,
  NopPaneHost,
  type Awaitable,
  type CommandHost,
  type PaneHost,
  type RuntimeHosts,
  type ViewHost,
} from './hosts.ts'

// How often a session refreshes the mod's resources.
const TICK = Temporal.Duration.from({ seconds: 1 })

// Until a session starts, a failure has nowhere to be reported.
const REPORT_NOTHING: HarnessAdapter['report'] = () => undefined

// What a tool call is followed by while no session started.
const NO_FOLLOWUP: Followup = {}

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

const paneKey = (id: string | PaneId): string => (typeof id === 'string' ? id : id.toString())

/**
 * A mod's session, which every target runs the same way: single-flight mount on `start`,
 * capability-enforced surface hosts, pane syncing, ticks, and hook dispatch.
 *
 * Parameterizing by `Caps extends Capabilities` ties the target's shared `CAPABILITIES` constant
 * to its runtime hosts at compile time: non-dropped `panes` and `commands` must be supplied by
 * {@link hosts}, while dropped ones receive `Nop*` hosts populated with their declared `why`.
 */
export abstract class ModkitTargetRuntime<
  Engine,
  Caps extends Capabilities = Capabilities,
> implements Disposable {
  readonly #mod: Mod<Options>
  readonly #options: Options
  readonly #images: Images
  readonly #capabilities: Caps
  #panes: PaneHost<Engine>
  #commands: CommandHost<Engine> = NOP_COMMAND_HOST
  #view: ViewHost<Engine> = NOP_VIEW_HOST
  #mounted: Mounted | undefined = undefined
  #opening: Promise<void> | undefined = undefined
  #isDisposed = false
  #report: HarnessAdapter['report'] = REPORT_NOTHING
  #shown: Shown = NOTHING_SHOWN
  // True while a command or a button press runs its synchronous part, up to its first `await`.
  // Background pane syncs wait it out, so a pane it opens opens on the interaction's own engine,
  // with keyboard focus and the relaxed placement rules an interaction gets.
  #isAnswering = false

  constructor({
    mod,
    options,
    images,
    capabilities,
  }: {
    mod: Mod<Options>
    options: Options
    images: Images
    capabilities: Caps
  }) {
    this.#mod = mod
    this.#options = options
    this.#images = images
    this.#capabilities = capabilities
    this.#panes = new NopPaneHost(
      capabilities.panes.kind === 'dropped' ? capabilities.panes.why : undefined,
    )
  }

  /** Whether the session started and has not been disposed. */
  protected get hasStarted(): boolean {
    return this.#mounted !== undefined && !this.#isDisposed
  }

  /** Whether the session has been torn down. */
  protected get isDisposed(): boolean {
    return this.#isDisposed
  }

  /** Active pane host (guaranteed real when `Caps['panes']` is not `'dropped'`). */
  protected get panes(): PaneHost<Engine> {
    return this.#panes
  }

  /** The adapter the mod's handlers reach the harness through for the session. */
  protected abstract adapter(engine: Engine): Awaitable<HarnessAdapter>

  /** Have the harness call `repeat.tick` every `repeat.everyMs` for the rest of the session. */
  protected abstract repeat(engine: Engine, repeat: Repeat): void

  /** Provide the surface hosts required by `Caps`. */
  protected abstract hosts(): RuntimeHosts<Engine, Caps>

  /**
   * Single-flight mount of the mod for a session: concurrent calls share one startup promise.
   */
  protected async start(engine: Engine): Promise<void> {
    this.#opening ??= this.#mount(engine)
    return this.#opening
  }

  /** Mark the session torn down, stopping queries and suppressing further redraws or pane syncs. */
  [Symbol.dispose](): void {
    this.#isDisposed = true
    this.#mounted?.[Symbol.dispose]()
  }

  /** A turn of the session's ended: refresh what the mod reads on one, without holding the turn. */
  protected turnEnded(): void {
    if (!this.#isDisposed) void this.#mounted?.event('turn.end')
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
  protected paneBody(id: string | PaneId): readonly UiNode[] | undefined {
    const key = paneKey(id)
    const view = this.#mounted?.view()
    const command = view?.commands.find((one) => one.pane?.id.equals(key) === true)
    return command?.pane?.body ?? view?.panes.find((pane) => pane.id === key)?.body
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
    return this.#toggled(engine, { id: command.pane.id, title: command.pane.title })
  }

  /** Answer the person pressing one of the mod's buttons, on the engine of the hook that drew it. */
  protected press(engine: Engine, { button, surface }: ButtonPress): void {
    void this.#answering(engine, async () => button.press({ surface }))
  }

  /** The person closed pane `id`: keep it closed while the mod shows it, and tell the mod. */
  protected async dismiss(id: string | PaneId): Promise<void> {
    const key = paneKey(id)
    if (!this.#shown.open.has(key)) return
    this.#shown = dismissed({ shown: this.#shown, id: key })
    await this.#mounted?.closed(key)
  }

  // Read through a method so TypeScript does not keep `#isDisposed` narrowed to `false` across `await`.
  #stopped(): boolean {
    return this.#isDisposed
  }

  async #mount(engine: Engine): Promise<void> {
    if (this.#stopped()) return
    this.#bindHosts()
    const adapter = await this.adapter(engine)
    if (this.#stopped()) return
    this.#report = (failure) => {
      adapter.report(failure)
    }
    this.#shown = NOTHING_SHOWN
    const mounted = mount({ mod: this.#mod, options: this.#options, adapter, images: this.#images })
    this.#mounted = mounted
    mounted.subscribe(() => {
      if (this.#stopped()) return
      void this.#view.redraw(engine)
      if (!this.#isAnswering) this.#syncPanes(engine, false)
    })
    this.#syncPanes(engine, false)
    await this.#registerCommands(engine, mounted)
    if (this.#stopped()) return
    this.repeat(engine, {
      everyMs: TICK.total('millisecond'),
      tick: () => {
        if (!this.#stopped()) void mounted.tick()
      },
    })
    await mounted.event('session.start')
    if (!this.#stopped()) await this.#view.redraw(engine)
  }

  async #registerCommands(engine: Engine, mounted: Mounted): Promise<void> {
    for (const command of mounted.view().commands) {
      if (this.#stopped()) return
      // oxlint-disable-next-line no-await-in-loop -- a harness takes registrations one at a time
      await this.#commands.register(engine, command)
    }
  }

  #bindHosts(): void {
    const provided: {
      readonly panes?: PaneHost<Engine>
      readonly commands?: CommandHost<Engine>
      readonly view?: ViewHost<Engine>
    } = this.hosts()
    this.#panes =
      provided.panes ??
      new NopPaneHost(
        this.#capabilities.panes.kind === 'dropped' ? this.#capabilities.panes.why : undefined,
      )
    this.#commands = provided.commands ?? NOP_COMMAND_HOST
    this.#view = provided.view ?? NOP_VIEW_HOST
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

  async #toggled(engine: Engine, { id, title }: { id: PaneId; title: string }): Promise<string> {
    if (await this.#panes.isShown(engine, id)) {
      await this.#panes.close(engine, id)
      return `${title} closed.`
    }
    const opened = await this.#panes.open(engine, { id, title, focus: true })
    return opened.isPlaced ? `${title} opened.` : `${title} waits: ${opened.reason}`
  }

  #syncPanes(engine: Engine, isAnswer: boolean): void {
    const mounted = this.#mounted
    if (mounted === undefined || this.#isDisposed) return
    const { shown, changes } = nextShown({ shown: this.#shown, rendered: mounted.view().panes })
    // Kept before any call goes out, so a render while they're under way sees them made.
    this.#shown = shown
    const fail = (error: unknown): void => {
      this.#report({ phase: 'render', error })
    }
    for (const change of changes) {
      const id = PaneId.parse(change.id)
      const changed =
        change.kind === 'close'
          ? Promise.resolve(this.#panes.close(engine, id))
          : Promise.resolve(this.#panes.open(engine, { id, title: change.title, focus: isAnswer }))
      changed.catch(fail)
    }
  }
}
