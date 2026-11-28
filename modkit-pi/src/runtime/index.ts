import { join } from 'node:path'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import { SettingsSchema, type SettingDecl } from '@atuin/modkit-target-node/runtime/settings'
import type { Tags } from '@atuin/modkit-target-node/runtime/store'
import type { CommandView, Images, Mod, Options } from '@atuin/modkit-target/host'

import { Cards } from './cards.ts'
import { PiMcpConfig } from './mcp.ts'
import { FOCUS_KEY } from './pane.ts'
import { PiRuntime } from './runtime.ts'

export interface Served {
  mod: Mod<Options>
  images: Images
  plugin: string
  settings: readonly SettingDecl[]
  state: Tags
  cards: readonly string[]
  hasPanes: boolean
}

class Extension {
  readonly #pi: ExtensionAPI
  readonly #served: Served
  readonly #dir: string
  readonly #settings: SettingsSchema
  readonly #commands = new Set<string>()
  readonly #cards: Cards
  #runtime: PiRuntime | undefined = undefined

  constructor({ pi, served }: { pi: ExtensionAPI; served: Served }) {
    this.#pi = pi
    this.#served = served
    this.#dir = join(PiMcpConfig.agentDir(), 'modkit', served.plugin)
    this.#settings = SettingsSchema.from(served.settings)
    this.#cards = new Cards({
      tools: served.cards,
      cards: (row) => this.#runtime?.cardsUnder(row) ?? [],
    })
  }

  register(): void {
    const pi = this.#pi
    pi.on('session_start', async (_event, ctx) => this.#start(ctx))
    pi.on('session_shutdown', (_event, ctx) => {
      this.#stop(ctx)
    })
    pi.on('agent_end', () => {
      this.#runtime?.endTurn()
    })
    pi.on('tool_call', async (event, ctx) => this.#runtime?.beforeCall(event, ctx))
    pi.on('tool_result', async (event, ctx) => this.#runtime?.afterCall(event, ctx))
    if (this.#served.cards.length > 0) pi.registerToolRenderer(this.#cards.resolver)
    if (!this.#served.hasPanes) return
    pi.registerShortcut(FOCUS_KEY, {
      description: `Move the keyboard between ${this.#served.plugin}'s panes and the prompt`,
      handler: () => {
        this.#runtime?.toggleFocus()
      },
    })
  }

  async #start(ctx: ExtensionContext): Promise<void> {
    this.#stop(ctx)
    const options = this.#loadSettings(ctx)
    if (options === undefined) return
    const { mod, images, plugin, state } = this.#served
    const runtime = new PiRuntime({
      mod,
      options,
      images,
      pi: this.#pi,
      plugin,
      dir: this.#dir,
      state,
      registerCommand: (command) => {
        this.#registerCommand(command)
      },
      redrawCards: () => {
        this.#cards.redraw()
      },
    })
    this.#runtime = runtime
    await runtime.startSession(ctx)
  }

  #stop(ctx: ExtensionContext): void {
    this.#runtime?.stop(ctx)
    this.#runtime = undefined
    this.#cards.forget()
  }

  #loadSettings(ctx: ExtensionContext): Options | undefined {
    const settings = this.#settings.loadFile(join(this.#dir, 'settings.json'))
    if (ctx.hasUI) {
      for (const problem of settings.problems) {
        ctx.ui.notify(`${this.#served.plugin}: ${problem}`, 'warning')
      }
    }
    return settings.isOk ? settings.options : undefined
  }

  // A command is pi's for the life of the extension, so each is registered once and runs on
  // whichever session is the current one.
  #registerCommand({ name, description }: CommandView): void {
    if (this.#commands.has(name)) return
    this.#commands.add(name)
    this.#pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        const said = await this.#runtime?.run(name, ctx)
        if (said !== undefined && said !== '' && ctx.hasUI) ctx.ui.notify(said, 'info')
      },
    })
  }
}

export function createPiExtension(served: Served): (pi: ExtensionAPI) => void {
  return (pi) => {
    new Extension({ pi, served }).register()
  }
}
