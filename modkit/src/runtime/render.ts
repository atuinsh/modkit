import * as v from 'valibot'

import type { ToolRow } from '../harness/types.ts'
import type { Parts } from '../modparts/mod.ts'
import { CommandPanePropsSchema, Pane, PanePropsSchema } from '../modparts/pane.ts'
import { Status } from '../modparts/status.ts'
import type { UiNode } from '../ui/node.ts'
import { Fragment, isElement, isTag, nameOf, primitiveOf, type ModElement } from './element.ts'
import { withFrame, type RenderScope } from './frame.ts'
import { PaneId } from './pane-id.ts'
import { CallbackSchema, checked, describe, type Callback } from './schema.ts'

/** Resolved slash command ready for a harness target to register. */
export interface CommandView {
  name: string
  description: string
  skill: string | undefined
  pane: { id: PaneId; title: string; body: readonly UiNode[] } | undefined
}

/** Resolved top-level pane ready for a harness target to open and render. */
export interface PaneView {
  id: string
  title: string
  body: readonly UiNode[]
}

export interface Rendered {
  statuses: readonly (readonly UiNode[])[]
  commands: readonly CommandView[]
  panes: readonly PaneView[]
  /** Top-level pane `onClose` handlers keyed by pane ID. */
  onClose: ReadonlyMap<string, Callback>
  onRun: ReadonlyMap<string, Callback>
  beforeShell: Callback | undefined
  afterShell: Callback | undefined
  beforeTool: ReadonlyMap<string, Callback>
  afterTool: ReadonlyMap<string, Callback>
  cards: ReadonlyMap<string, Callback>
}

const childrenOf = (element: ModElement): unknown => element.props['children']

function partsOf(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap((part) => partsOf(part))
  if (node === null || node === undefined || typeof node === 'boolean') return []
  return [node]
}

const SHELLS = { Status, Pane } as const
const OTHER = { Status: 'Pane', Pane: 'Status' } as const

const componentOf = (part: Callback): ModElement => ({
  type: part,
  props: {},
  key: undefined,
})

const CommandSchema = v.object({
  description: v.string(),
  skill: v.optional(v.string()),
  run: v.optional(CallbackSchema),
  pane: v.optional(CallbackSchema),
})

const PartsSchema = v.object({
  status: v.optional(CallbackSchema),
  panes: v.optional(v.array(CallbackSchema)),
  commands: v.optional(v.record(v.string(), CommandSchema)),
  beforeShell: v.optional(CallbackSchema),
  afterShell: v.optional(CallbackSchema),
  beforeTool: v.optional(v.record(v.string(), CallbackSchema)),
  afterTool: v.optional(v.record(v.string(), CallbackSchema)),
  toolCards: v.optional(v.record(v.string(), CallbackSchema)),
})

type Checked = v.InferOutput<typeof PartsSchema>

function checkedParts(parts: unknown): Checked {
  const parsed = v.safeParse(PartsSchema, parts)
  if (parsed.success) return parsed.output
  const [issue] = parsed.issues
  const path = issue.path?.map((one) => String(one.key)).join('.') ?? ''
  throw new TypeError(`a mod's ${path === '' ? 'parts' : path}: ${issue.message}`)
}

const byTool = (handlers: Readonly<Record<string, Callback>> | undefined): Map<string, Callback> =>
  new Map(Object.entries(handlers ?? {}))

function exceptBash({
  handlers,
  part,
}: {
  handlers: Checked['beforeTool']
  part: string
}): Map<string, Callback> {
  if (handlers !== undefined && 'Bash' in handlers) {
    const shell = part.replace('Tool', 'Shell')
    throw new Error(`${part}.Bash is ${shell}, which hands it the command`)
  }
  return byTool(handlers)
}

function checkPaneIds({
  commands,
  panes,
}: {
  commands: readonly CommandView[]
  panes: readonly PaneView[]
}): void {
  const byPaneId = new Map<string, string>()
  for (const command of commands) {
    if (command.pane === undefined) continue
    const key = command.pane.id.toString()
    const earlier = byPaneId.get(key)
    if (earlier !== undefined) {
      throw new Error(
        `/${command.name}'s pane shares the sanitized id ${key} with /${earlier}'s pane; rename one`,
      )
    }
    byPaneId.set(key, command.name)
  }
  const shared = panes.find((pane) => byPaneId.has(pane.id))
  if (shared !== undefined) {
    const owner = byPaneId.get(shared.id) ?? shared.id
    throw new Error(`the <Pane> id ${shared.id} names /${owner}'s pane already; give it another`)
  }
}

/**
 * One render of a mod, inside the {@link RenderScope} its hooks read and write through.
 *
 * A render calls the mod's components and walks what they return into the {@link UiNode} trees a
 * target draws, checking each modpart's props on the way.
 */
export class Render {
  readonly #scope: RenderScope

  constructor(scope: RenderScope) {
    this.#scope = scope
  }

  /** Render the mod's `setup` with `settings` into everything its modparts show and handle. */
  mod({ setup, settings }: { setup: (settings: never) => Parts; settings: object }): Rendered {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/consistent-type-assertions -- mount matched the settings to the mod's
    const root = componentOf(setup as unknown as Callback)
    const parts = checkedParts(
      withFrame({ scope: this.#scope, component: 'mod' }, () => root.type({ ...settings })),
    )
    const statuses =
      parts.status === undefined
        ? []
        : this.#shells({ node: componentOf(parts.status), shell: 'Status', part: 'status' })
    const commands = Object.entries(parts.commands ?? {}).map(([name, command]) =>
      this.#command(name, command),
    )
    const panes = this.#panes(parts.panes ?? [])
    checkPaneIds({ commands, panes: panes.views })
    return {
      statuses: statuses.map((status) => this.#walk(childrenOf(status))),
      commands,
      panes: panes.views,
      onClose: panes.onClose,
      onRun: new Map(
        Object.entries(parts.commands ?? {}).flatMap(([name, { run }]) =>
          run === undefined ? [] : [[name, run] as const],
        ),
      ),
      beforeShell: parts.beforeShell,
      afterShell: parts.afterShell,
      beforeTool: exceptBash({ handlers: parts.beforeTool, part: 'beforeTool' }),
      afterTool: exceptBash({ handlers: parts.afterTool, part: 'afterTool' }),
      cards: byTool(parts.toolCards),
    }
  }

  /** Render the tool card `card` draws for `row`. */
  card(card: Callback, row: ToolRow): UiNode[] {
    return this.#walk(withFrame({ scope: this.#scope, component: 'toolCards' }, () => card(row)))
  }

  #call(element: ModElement): unknown {
    return withFrame({ scope: this.#scope, component: nameOf(element) }, () =>
      element.type(element.props),
    )
  }

  #walk(node: unknown): UiNode[] {
    return partsOf(node).flatMap((part): UiNode[] => {
      if (typeof part === 'string' || typeof part === 'number') return [String(part)]
      if (!isElement(part)) throw new TypeError(`a component returned ${describe(part)}`)
      if (isTag({ element: part, tag: Status }) || isTag({ element: part, tag: Pane })) {
        const name = nameOf(part)
        throw new Error(
          `<${name}> is what a mod's status or panes return, not what goes inside one`,
        )
      }
      if (isTag({ element: part, tag: Fragment })) return this.#walk(childrenOf(part))
      const drawn = primitiveOf(part.type)
      if (drawn === undefined) return this.#walk(this.#call(part))
      return [
        drawn.node({
          props: checked({ holder: `<${nameOf(part)}>`, schema: drawn.schema, value: part.props }),
          key: part.key,
          children: this.#walk(childrenOf(part)),
          scope: this.#scope,
        }),
      ]
    })
  }

  // The <Status> or <Pane> elements `node` renders to, which `part` names in an error.
  #shells({
    node,
    shell,
    part,
  }: {
    node: unknown
    shell: 'Status' | 'Pane'
    part: string
  }): ModElement[] {
    return partsOf(node).flatMap((one): ModElement[] => {
      const wrong = (): TypeError =>
        new TypeError(`${part} returns a <${shell}>, not ${describe(one)}`)
      if (!isElement(one)) throw wrong()
      if (isTag({ element: one, tag: SHELLS[shell] })) return [one]
      if (isTag({ element: one, tag: Fragment })) {
        return this.#shells({ node: childrenOf(one), shell, part })
      }
      if (
        primitiveOf(one.type) !== undefined ||
        isTag({ element: one, tag: SHELLS[OTHER[shell]] })
      ) {
        throw new TypeError(`${part} returns a <${shell}>, not a <${nameOf(one)}>`)
      }
      return this.#shells({ node: this.#call(one), shell, part })
    })
  }

  #command(name: string, command: NonNullable<Checked['commands']>[string]): CommandView {
    const { description, skill, run, pane } = command
    if ((run === undefined) === (pane === undefined)) {
      throw new Error(`/${name} runs its \`run\` or toggles its \`pane\`: one of them, not both`)
    }
    if (pane === undefined) return { name, description, skill, pane: undefined }
    const part = `/${name}'s pane`
    const [element, ...rest] = this.#shells({ node: componentOf(pane), shell: 'Pane', part })
    if (element === undefined || rest.length > 0) {
      throw new Error(`${part} returns exactly one <Pane>`)
    }
    if (element.props['id'] !== undefined || element.props['onClose'] !== undefined) {
      throw new Error(`${part} is named by the command, and takes no id or onClose`)
    }
    const { title } = checked({
      holder: `<${nameOf(element)}>`,
      schema: CommandPanePropsSchema,
      value: element.props,
    })
    return {
      name,
      description,
      skill,
      pane: { id: PaneId.fromCommand(name), title, body: this.#walk(childrenOf(element)) },
    }
  }

  #panes(panes: readonly Callback[]): { views: PaneView[]; onClose: Map<string, Callback> } {
    const elements = panes.flatMap((pane) =>
      this.#shells({ node: componentOf(pane), shell: 'Pane', part: 'a pane' }),
    )
    const onClose = new Map<string, Callback>()
    const views = elements.map((element): PaneView => {
      const props = checked({
        holder: `<${nameOf(element)}>`,
        schema: PanePropsSchema,
        value: element.props,
      })
      if (props.onClose !== undefined) onClose.set(props.id, props.onClose)
      return { id: props.id, title: props.title, body: this.#walk(childrenOf(element)) }
    })
    const twice = views.find((one, index) => views.findIndex((pane) => pane.id === one.id) < index)
    if (twice !== undefined) throw new Error(`two <Pane>s have the id ${twice.id}`)
    return { views, onClose }
  }
}
