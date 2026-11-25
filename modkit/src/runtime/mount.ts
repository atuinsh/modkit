import type {
  Followup,
  HarnessAdapter,
  Phase,
  ShellCall,
  ShellResult,
  ToolCall,
  ToolResult,
  ToolRow,
  Verdict,
} from '../harness/index'
import { followupOf, verdictOf, type Mod, type Options, type Parts } from '../modparts/mod'
import type { HarnessEvent } from '../ui/hooks/query'
import type { UiNode } from '../ui/node'
import { isRendering, type QueryRegistration, type RenderScope } from './frame'
import { Queries } from './queries'
import { render, renderCard, type CommandView, type PaneView, type Rendered } from './render'
import { JsonSchema, checked, type Callback } from './schema'

/** Snapshot of the UI modparts produced by the mod's latest successful render. */
export interface View {
  statuses: readonly (readonly UiNode[])[]
  commands: readonly CommandView[]
  /** Top-level panes currently rendered (excluding panes nested inside commands). */
  panes: readonly PaneView[]
}

/** Running mod instance driven by a harness target. */
export interface Mounted {
  /** Return the latest rendered {@link View}. */
  view(): View
  beforeShell(call: ShellCall): Promise<Verdict>
  afterShell(result: ShellResult): Promise<Followup>
  beforeTool(call: ToolCall): Promise<Verdict>
  afterTool(result: ToolResult): Promise<Followup>
  cards(row: ToolRow): UiNode[]
  event(event: Exclude<HarnessEvent, 'shell.after'>): Promise<void>
  tick(): Promise<void>
  settle(): Promise<void>
  ran(name: string): Promise<string | undefined>
  /** Execute the `onClose` handler for top-level pane `id`, if one is registered. */
  closed(id: string): Promise<void>
  /** Register `listener` to run after each state-driven re-render. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void
}

const NOTHING: Rendered = {
  statuses: [],
  commands: [],
  panes: [],
  onClose: new Map(),
  onRun: new Map(),
  beforeShell: undefined,
  afterShell: undefined,
  beforeTool: new Map(),
  afterTool: new Map(),
  cards: new Map(),
}

class MountedMod implements Mounted {
  readonly #setup: (settings: never) => Parts
  readonly #options: object
  readonly #adapter: HarnessAdapter
  readonly #listeners = new Set<() => void>()
  readonly #queries: Queries
  #rendered: Rendered = NOTHING

  constructor({
    setup,
    options,
    adapter,
  }: {
    setup: (settings: never) => Parts
    options: object
    adapter: HarnessAdapter
  }) {
    this.#setup = setup
    this.#options = options
    this.#adapter = adapter
    this.#queries = new Queries({
      adapter,
      write: (change) => {
        this.#write(change)
      },
    })
    this.#render()
  }

  view(): View {
    const { statuses, commands, panes } = this.#rendered
    return { statuses, commands, panes }
  }

  async beforeShell(call: ShellCall): Promise<Verdict> {
    const handler = this.#rendered.beforeShell
    return this.#answered({ phase: 'beforeShell', answer: verdictOf, handler, input: call })
  }

  async afterShell(result: ShellResult): Promise<Followup> {
    const handler = this.#rendered.afterShell
    const followup = await this.#answered({
      phase: 'afterShell',
      answer: followupOf,
      handler,
      input: result,
    })
    void this.#queries.refreshDue('shell.after')
    return followup
  }

  async beforeTool(call: ToolCall): Promise<Verdict> {
    const handler = this.#rendered.beforeTool.get(call.tool)
    return this.#answered({ phase: 'beforeTool', answer: verdictOf, handler, input: call })
  }

  async afterTool(result: ToolResult): Promise<Followup> {
    const handler = this.#rendered.afterTool.get(result.tool)
    return this.#answered({ phase: 'afterTool', answer: followupOf, handler, input: result })
  }

  async event(event: Exclude<HarnessEvent, 'shell.after'>): Promise<void> {
    return this.#queries.refreshDue(event)
  }

  async tick(): Promise<void> {
    return this.#queries.refreshDue()
  }

  async settle(): Promise<void> {
    return this.#queries.settle()
  }

  async ran(name: string): Promise<string | undefined> {
    const onRun = this.#rendered.onRun.get(name)
    if (onRun === undefined) return undefined
    try {
      const said = await onRun()
      return typeof said === 'string' ? said : undefined
    } catch (error) {
      this.#adapter.report({ phase: 'command', error })
      return undefined
    }
  }

  async closed(id: string): Promise<void> {
    const onClose = this.#rendered.onClose.get(id)
    if (onClose === undefined) return
    try {
      await onClose()
    } catch (error) {
      this.#adapter.report({ phase: 'close', error })
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // A handler that throws, or answers what `answer` refuses, has no say: the mod fails open.
  async #answered<T>({
    phase,
    answer,
    handler,
    input,
  }: {
    phase: Phase
    answer: (value?: unknown) => T
    handler: Callback | undefined
    input: unknown
  }): Promise<T> {
    try {
      return answer(handler === undefined ? undefined : await handler(input))
    } catch (error) {
      this.#adapter.report({ phase, error })
      return answer()
    }
  }

  cards(row: ToolRow): UiNode[] {
    const scope = this.#scope([])
    const card = this.#rendered.cards.get(row.tool)
    if (card === undefined) return []
    try {
      return renderCard({ render: card, row, scope })
    } catch (error) {
      this.#adapter.report({ phase: 'render', error })
      return []
    }
  }

  #scope(registrations: QueryRegistration[]): RenderScope {
    return {
      harness: this.#adapter,
      store: this.#adapter.store,
      write: (change) => {
        this.#write(change)
      },
      action: (onPress) => async (press) => {
        try {
          await onPress(press)
        } catch (error) {
          this.#adapter.report({ phase: 'press', error })
        }
      },
      query: (registration) => {
        registrations.push(registration)
      },
      refresh: async (id) => this.#queries.refresh(id),
    }
  }

  #render(): void {
    const registrations: QueryRegistration[] = []
    const scope = this.#scope(registrations)
    try {
      const rendered = render({ setup: this.#setup, settings: this.#options, scope })
      this.#queries.register(registrations)
      this.#rendered = rendered
    } catch (error) {
      this.#adapter.report({ phase: 'render', error })
    }
  }

  #write(change: Parameters<RenderScope['write']>[0]): void {
    if (isRendering()) throw new Error('a state setter runs in a handler, never while rendering')
    checked({ holder: change.key, schema: JsonSchema, value: change.stored.value })
    this.#adapter.store.set(change.key, change.stored)
    this.#render()
    for (const listener of this.#listeners) listener()
  }
}

export function mount<Settings extends Options>({
  mod,
  options,
  adapter,
}: {
  mod: Mod<Settings>
  options: Settings
  adapter: HarnessAdapter
}): Mounted {
  return new MountedMod({ setup: mod.setup, options, adapter })
}
